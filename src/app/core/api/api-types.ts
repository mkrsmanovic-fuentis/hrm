/**
 * Type helpers that read request and response shapes from the generated OpenAPI types.
 * Shared by the API client and the mock API, so both follow the same contract.
 * Never hand-write API types: change docs/api-reference/openapi.yaml and run `pnpm api:types`.
 */
import type { paths } from './api-schema.gen';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Every path in the spec, without the base path, for example `/topics/{topicId}`. */
export type ApiPath = keyof paths;

/** Paths that support the given method. */
export type ApiPathWith<M extends HttpMethod> = {
  [P in ApiPath]: [NonNullable<paths[P][M]>] extends [never] ? never : P;
}[ApiPath];

/** The operation behind a method and path. */
export type ApiOperation<P extends ApiPath, M extends HttpMethod> = NonNullable<paths[P][M]>;

type Parameters<O> = O extends { parameters: infer T } ? T : never;

/** Path parameters of an operation, or `never` when it has none. */
export type ApiPathParams<O> = Parameters<O> extends { path: infer T } ? T : never;

/** Query parameters of an operation, or `never` when it has none. */
export type ApiQueryParams<O> =
  Parameters<O> extends { query?: infer T }
    ? [T] extends [undefined]
      ? never
      : NonNullable<T>
    : never;

/** JSON request body of an operation, or `never` when it has none. */
export type ApiRequestBody<O> = O extends { requestBody?: infer R }
  ? [NonNullable<R>] extends [never]
    ? never
    : NonNullable<R> extends { content: { 'application/json': infer B } }
      ? B
      : never
  : never;

type JsonContent<R> = R extends { content: { 'application/json': infer B } } ? B : void;
type Responses<O> = O extends { responses: infer R } ? R : never;

/** JSON body of the operation's success response (200 or 201), or `void` for 204. */
export type ApiResponseBody<O> = 200 extends keyof Responses<O>
  ? JsonContent<Responses<O>[200]>
  : 201 extends keyof Responses<O>
    ? JsonContent<Responses<O>[201]>
    : void;

type Empty = Record<never, never>;
type PathOption<O> = [ApiPathParams<O>] extends [never] ? Empty : { path: ApiPathParams<O> };
type QueryOption<O> = [ApiQueryParams<O>] extends [never] ? Empty : { query?: ApiQueryParams<O> };
type BodyOption<O> = [ApiRequestBody<O>] extends [never] ? Empty : { body: ApiRequestBody<O> };

/** Options for one call: `path` and `body` when the operation needs them, `query` when it accepts it. */
export type ApiRequestOptions<O> = PathOption<O> & QueryOption<O> & BodyOption<O>;

/** Makes the options argument optional when nothing in it is required. */
export type ApiRequestArgs<O> = Empty extends PathOption<O> & BodyOption<O>
  ? [options?: ApiRequestOptions<O>]
  : [options: ApiRequestOptions<O>];
