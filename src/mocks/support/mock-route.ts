import { delay, http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw';
import type {
  ApiOperation,
  ApiPathParams,
  ApiPathWith,
  ApiResponseBody,
  HttpMethod,
} from '../../app/core/api/api-types';
import type { FieldError } from '../../app/core/api/api-schema.gen';
import type { UserRecord } from '../db/mock-data';
import type { MockDb } from '../db/mock-db';
import { authenticate } from './auth';
import { MockProblem, problemResponse, validationProblem } from './problem';
import { paginate, QueryReader, type PageRequest } from './query';
import { flagsApplyTo, type SimulationFlags } from './simulation';

/** What every handler runs against. The browser and unit tests each build their own. */
export interface MockEnvironment {
  db: MockDb;
  /** API base path, for example `/api/v1`. */
  baseUrl: string;
  /** Current simulation flags. */
  flags: () => SimulationFlags;
  /** Delay before every response: `'real'` for a realistic random delay, or milliseconds. */
  latency: 'real' | number;
  /** The current time. Tests pass a fixed date. */
  now: () => Date;
  /**
   * Runs one request at a time across browser tabs, from loading the latest data to saving the
   * changes, so no tab's write is lost. The browser passes a Web Lock; tests may pass their own.
   */
  exclusive?: <T>(run: () => Promise<T>) => Promise<T>;
}

/** Everything a resolver needs, typed from the operation in the spec. */
export interface MockContext<O> {
  request: Request;
  url: URL;
  /** Path parameters, as strings. */
  params: [ApiPathParams<O>] extends [never]
    ? Record<string, never>
    : { [K in keyof ApiPathParams<O>]: string };
  /** Validating reader for query parameters. */
  query: QueryReader;
  db: MockDb;
  now: Date;
  /**
   * The signed-in user, from the session token. Always set, except on public routes
   * (`{ public: true }`), which run without a session.
   */
  currentUser: UserRecord | null;
  /** Success response. The body type comes from the spec, so the mock cannot drift from it. */
  ok(body: ApiResponseBody<O>, status?: 200 | 201): Response;
  noContent(): Response;
  problem(status: number, detail?: string): Response;
  notFound(detail?: string): Response;
  validationFailed(errors: FieldError[]): Response;
  /** One page of `items`. Returns an empty page when the `mock-empty` flag applies. */
  page<T>(
    items: readonly T[],
    request: PageRequest,
  ): { items: T[]; page: ReturnType<typeof paginate>['page'] };
  /** Parses the JSON body. Answers 400 when it is not valid JSON. */
  json<T = unknown>(): Promise<T>;
}

type Resolver<O> = (ctx: MockContext<O>) => Response | Promise<Response>;

export interface RouteOptions {
  /**
   * Skip the session token check. Only sign-in and sign-out are public; every other route
   * answers 401 without a valid token.
   */
  public?: boolean;
}

/** A handler definition, bound to an environment when the mock starts. */
export type MockRoute = (env: MockEnvironment) => HttpHandler;

function define<M extends HttpMethod>(method: M) {
  return <P extends ApiPathWith<M>>(
      path: P,
      resolver: Resolver<ApiOperation<P, M>>,
      options: RouteOptions = {},
    ): MockRoute =>
    (env) =>
      http[method](`*${env.baseUrl}${toMswPath(path)}`, async ({ request, params }) => {
        const url = new URL(request.url);
        const apiPath = url.pathname.slice(url.pathname.indexOf(env.baseUrl) + env.baseUrl.length);
        const flags = env.flags();
        const active = flagsApplyTo(flags, apiPath) ? flags : {};

        await wait(env.latency, active.delayMs);
        if (active.errorStatus) return simulatedError(active.errorStatus, url.pathname);

        const handle = () =>
          resolve(env, request, url, options, (currentUser) =>
            resolver(
              createContext<ApiOperation<P, M>>(
                env,
                request,
                url,
                params,
                active.empty === true,
                currentUser,
              ),
            ),
          );
        return env.exclusive ? env.exclusive(handle) : handle();
      });
}

/**
 * Runs one request against the latest data and saves its changes: loads what other tabs saved,
 * checks the session, runs the handler (turning failures into problems), then saves.
 */
async function resolve(
  env: MockEnvironment,
  request: Request,
  url: URL,
  options: RouteOptions,
  run: (currentUser: UserRecord | null) => Response | Promise<Response>,
): Promise<Response> {
  await env.db.sync();
  try {
    return await authenticateAndRun(env, request, url, options, run);
  } finally {
    await env.db.flush();
  }
}

async function authenticateAndRun(
  env: MockEnvironment,
  request: Request,
  url: URL,
  options: RouteOptions,
  run: (currentUser: UserRecord | null) => Response | Promise<Response>,
): Promise<Response> {
  let currentUser: UserRecord | null = null;
  if (!options.public) {
    const auth = authenticate(env.db.data, request, env.now());
    if (!auth.ok) return problemResponse(401, auth.detail, { instance: url.pathname });
    currentUser = auth.user;
  }

  try {
    return await run(currentUser);
  } catch (error) {
    if (error instanceof MockProblem) {
      return problemResponse(error.status, error.detail, {
        instance: url.pathname,
        errors: error.errors,
        extensions: error.extensions,
        kind: error.kind,
      });
    }
    console.error(`[mock api] ${request.method} ${url.pathname} failed`, error);
    return problemResponse(500, 'The mock handler failed. See the browser console.', {
      instance: url.pathname,
    });
  }
}

/**
 * Defines mock handlers by spec path and method. Paths and response bodies are type-checked
 * against the generated OpenAPI types. Every route checks the session token and answers 401
 * without a valid one, unless it passes `{ public: true }`.
 *
 * @example
 * export const topicRoutes = [
 *   route.get('/topics/{topicId}', ({ db, params, ok, notFound }) => {
 *     const topic = db.data.topics.find((t) => t.id === params.topicId);
 *     return topic ? ok(topic) : notFound(`Topic ${params.topicId} was not found.`);
 *   }),
 * ];
 */
export const route = {
  get: define('get'),
  post: define('post'),
  put: define('put'),
  patch: define('patch'),
  delete: define('delete'),
};

/** Answers API requests that no handler matched with a 404 problem, instead of reaching the network. */
export const unhandledApiRoute: MockRoute = (env) =>
  http.all(`*${env.baseUrl}/*`, ({ request }) => {
    const { pathname } = new URL(request.url);
    return problemResponse(
      404,
      `No mock handler for ${request.method} ${pathname}. Add one in src/mocks/resources/.`,
      {
        instance: pathname,
      },
    );
  });

function createContext<O>(
  env: MockEnvironment,
  request: Request,
  url: URL,
  params: Record<string, string | readonly string[] | undefined>,
  emptyLists: boolean,
  currentUser: UserRecord | null,
): MockContext<O> {
  const instance = url.pathname;
  return {
    request,
    url,
    params: params as MockContext<O>['params'],
    query: new QueryReader(url.searchParams),
    db: env.db,
    now: env.now(),
    currentUser,
    ok: (body, status = 200) => HttpResponse.json(body as JsonBodyType, { status }),
    noContent: () => new HttpResponse(null, { status: 204 }),
    problem: (status, detail) => problemResponse(status, detail, { instance }),
    notFound: (detail) => problemResponse(404, detail, { instance }),
    validationFailed: (errors) => validationProblem(errors, instance),
    page: (items, pageRequest) => paginate(emptyLists ? [] : items, pageRequest),
    json: async <T>() => {
      try {
        return (await request.clone().json()) as T;
      } catch {
        throw new MockProblem(400, 'The request body is not valid JSON.');
      }
    },
  };
}

function simulatedError(status: number, instance: string): Response {
  const detail = 'Simulated by the mock-error flag.';
  if (status === 422) {
    return validationProblem(
      [{ location: 'body', field: 'name', code: 'invalid_value', message: detail }],
      instance,
    );
  }
  return problemResponse(status, detail, { instance });
}

async function wait(latency: MockEnvironment['latency'], extraMs = 0): Promise<void> {
  if (latency === 'real') await delay();
  else if (latency > 0) await delay(latency);
  if (extraMs > 0) await delay(extraMs);
}

/** `/topics/{topicId}` → `/topics/:topicId` */
function toMswPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, ':$1');
}
