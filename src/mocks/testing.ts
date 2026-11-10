import {
  HttpBackend,
  HttpErrorResponse,
  HttpEvent,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import type { Provider } from '@angular/core';
import { getResponse, type HttpHandler } from 'msw';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';
import { MockDb } from './db/mock-db';
import type { MockStore } from './db/mock-store';
import { createHandlers } from './handlers';
import type { RoleKey } from '../app/core/api/api-schema.gen';
import { SESSION_LIFETIME_MS } from './rules/auth-rules';
import { buildSeed, SEED_VERSION } from './seed/seed';
import { unhandledApiRoute, type MockEnvironment, type MockRoute } from './support/mock-route';
import type { SimulationFlags } from './support/simulation';

/** Fixed "now" for tests, so dates and statuses in the seed are stable. */
export const TEST_NOW = new Date('2026-11-10T12:00:00Z');

export interface TestMockApiOptions {
  now?: Date;
  flags?: SimulationFlags;
  /**
   * Who the requests are sent as. By default a session is started for the first seeded
   * administrator, and its token is added to every request that has no `Authorization` header.
   * Pass `null` to send requests without a session, for example to test sign-in.
   */
  signedInAs?: RoleKey | null;
  /**
   * Routes to serve instead of the app's, for example a test route that exercises a helper such
   * as `requireRole()`. Unknown API paths still answer 404.
   */
  routes?: MockRoute[];
  /**
   * Where the mock data is shared. Leave it out to keep data in this mock API only. Give two mock
   * APIs the same `MemoryMockStore` to test two browser tabs that share the data.
   */
  store?: MockStore;
  /** Wraps every handler, as the browser's cross-tab lock does. */
  exclusive?: MockEnvironment['exclusive'];
}

/**
 * The mock API for unit tests: the same handlers and seed as the browser, with an in-memory
 * database, no delay and a fixed date.
 *
 * @example
 * const mock = createTestMockApi();
 * TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
 * // HttpClient (and so ApiClient) now talks to the mock handlers.
 */
export function createTestMockApi(options: TestMockApiOptions = {}) {
  const now = options.now ?? TEST_NOW;
  const db = new MockDb({
    seed: () => buildSeed(now),
    store: options.store ?? null,
    version: SEED_VERSION,
  });
  const token = startTestSession(
    db,
    options.signedInAs === undefined ? 'administrator' : options.signedInAs,
    now,
  );
  const env: MockEnvironment = {
    db,
    baseUrl: environment.apiBaseUrl,
    flags: () => options.flags ?? {},
    latency: 0,
    now: () => now,
    exclusive: options.exclusive,
  };
  const handlers = options.routes
    ? [...options.routes, unhandledApiRoute].map((defineRoute) => defineRoute(env))
    : createHandlers(env);
  const providers: Provider[] = [
    { provide: HttpBackend, useValue: new MockHttpBackend(handlers, token) },
  ];

  return {
    db,
    handlers,
    /** The session token requests are sent with, or null when signed out. */
    token,
    /** Add after `provideHttpClient()` so HttpClient sends requests to the mock handlers. */
    providers,
    /** Sends a request straight to the handlers, for handler tests without Angular. */
    fetch: (path: string, init?: RequestInit) =>
      getResponse(
        handlers,
        withToken(new Request(new URL(path, 'http://localhost'), init), token),
      ).then(
        (response) =>
          response ?? new Response(null, { status: 599, statusText: 'No mock handler' }),
      ),
  };
}

/** Starts a session for the first active seeded user with the role, and returns its token. */
function startTestSession(db: MockDb, role: RoleKey | null, now: Date): string | null {
  if (!role) return null;
  const user = db.data.users.find((u) => u.role === role && u.status === 'active');
  if (!user) throw new Error(`The seed has no active ${role}.`);
  const token = `test-session-${role}`;
  db.update((data) =>
    data.sessions.push({
      token,
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
    }),
  );
  return token;
}

/** Adds the session token unless the request already has an `Authorization` header. */
function withToken(request: Request, token: string | null): Request {
  if (!token || request.headers.has('Authorization')) return request;
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return new Request(request, { headers });
}

/** An Angular HttpBackend that answers requests with MSW handlers, without a network or service worker. */
export class MockHttpBackend implements HttpBackend {
  constructor(
    private readonly handlers: HttpHandler[],
    private readonly token: string | null = null,
  ) {}

  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    return new Observable<HttpEvent<unknown>>((observer) => {
      const url = new URL(req.urlWithParams, 'http://localhost').toString();
      const headers = new Headers();
      req.headers
        .keys()
        .forEach((name) => headers.set(name, req.headers.getAll(name)?.join(',') ?? ''));
      const contentType = req.detectContentTypeHeader();
      if (contentType && !headers.has('Content-Type')) headers.set('Content-Type', contentType);
      const body = req.serializeBody();
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (body as BodyInit | null),
      });

      getResponse(this.handlers, withToken(request, this.token))
        .then(async (response) => {
          if (!response) {
            observer.error(
              new HttpErrorResponse({ url, status: 0, statusText: 'No mock handler' }),
            );
            return;
          }
          const text = await response.text();
          const isJson = /json/.test(response.headers.get('Content-Type') ?? '');
          const responseBody =
            text && isJson && req.responseType === 'json' ? JSON.parse(text) : text || null;
          const init = {
            url,
            status: response.status,
            statusText: response.statusText,
            headers: new HttpHeaders(Object.fromEntries(response.headers.entries())),
          };
          if (response.ok) {
            observer.next(new HttpResponse({ ...init, body: responseBody }));
            observer.complete();
          } else {
            observer.error(new HttpErrorResponse({ ...init, error: responseBody }));
          }
        })
        .catch((error: unknown) =>
          observer.error(new HttpErrorResponse({ url, status: 0, error })),
        );
    });
  }
}
