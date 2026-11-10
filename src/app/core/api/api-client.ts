import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { catchError, map, Observable, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiError } from './api-error';
import type {
  ApiOperation,
  ApiPathWith,
  ApiRequestArgs,
  ApiResponseBody,
  HttpMethod,
} from './api-types';

/** Base URL every API path is appended to. Defaults to `environment.apiBaseUrl`. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => environment.apiBaseUrl,
});

type QueryValue = string | number | boolean | null | undefined;

/** A response body with the response headers, from {@link ApiClient.postWithHeaders}. */
export interface ApiResponse<T> {
  body: T;
  headers: HttpHeaders;
}

/**
 * Demo only: the response header in which the mock API sends the link it would have emailed,
 * such as an invite or password reset link. The real backend never sends it.
 */
export const DEMO_LINK_HEADER = 'X-Demo-Link';

/** The demo-only link from a response's headers, or null when there is none. */
export function demoLinkOf(response: ApiResponse<unknown>): string | null {
  return response.headers.get(DEMO_LINK_HEADER);
}

interface RawOptions {
  path?: Record<string, string | number>;
  query?: Record<string, QueryValue | readonly QueryValue[]>;
  body?: unknown;
}

/**
 * Typed access to the HRM Platform API. Paths, parameters, bodies and responses are checked
 * against the OpenAPI spec through the generated types. Every feature calls the API through
 * this service; components never use HttpClient directly.
 *
 * Calls fail with an {@link ApiError}.
 *
 * @example
 * api.get('/topics', { query: { page: 2, status: 'active' } }); // Observable<TopicPage>
 * api.get('/topics/{topicId}', { path: { topicId } });           // Observable<Topic>
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  get<P extends ApiPathWith<'get'>>(
    path: P,
    ...[options]: ApiRequestArgs<ApiOperation<P, 'get'>>
  ): Observable<ApiResponseBody<ApiOperation<P, 'get'>>> {
    return this.request('get', path, options);
  }

  post<P extends ApiPathWith<'post'>>(
    path: P,
    ...[options]: ApiRequestArgs<ApiOperation<P, 'post'>>
  ): Observable<ApiResponseBody<ApiOperation<P, 'post'>>> {
    return this.request('post', path, options);
  }

  /**
   * Like {@link post}, but also returns the response headers, for the few endpoints whose spec
   * describes a header, such as the demo-only `X-Demo-Link`.
   */
  postWithHeaders<P extends ApiPathWith<'post'>>(
    path: P,
    ...[options]: ApiRequestArgs<ApiOperation<P, 'post'>>
  ): Observable<ApiResponse<ApiResponseBody<ApiOperation<P, 'post'>>>> {
    const { path: pathParams, query, body } = (options ?? {}) as RawOptions;
    const url = this.baseUrl + buildPath(path, pathParams);
    return this.http
      .post<ApiResponseBody<ApiOperation<P, 'post'>>>(url, body ?? null, {
        params: buildParams(query),
        observe: 'response',
      })
      .pipe(
        map((response) => ({
          body: response.body as ApiResponseBody<ApiOperation<P, 'post'>>,
          headers: response.headers,
        })),
        catchError(toApiError),
      );
  }

  put<P extends ApiPathWith<'put'>>(
    path: P,
    ...[options]: ApiRequestArgs<ApiOperation<P, 'put'>>
  ): Observable<ApiResponseBody<ApiOperation<P, 'put'>>> {
    return this.request('put', path, options);
  }

  patch<P extends ApiPathWith<'patch'>>(
    path: P,
    ...[options]: ApiRequestArgs<ApiOperation<P, 'patch'>>
  ): Observable<ApiResponseBody<ApiOperation<P, 'patch'>>> {
    return this.request('patch', path, options);
  }

  delete<P extends ApiPathWith<'delete'>>(
    path: P,
    ...[options]: ApiRequestArgs<ApiOperation<P, 'delete'>>
  ): Observable<ApiResponseBody<ApiOperation<P, 'delete'>>> {
    return this.request('delete', path, options);
  }

  private request<T>(method: HttpMethod, path: string, options: object | undefined): Observable<T> {
    const { path: pathParams, query, body } = (options ?? {}) as RawOptions;
    const url = this.baseUrl + buildPath(path, pathParams);
    return this.http
      .request<T>(method.toUpperCase(), url, { params: buildParams(query), body })
      .pipe(catchError(toApiError));
  }
}

function toApiError(error: unknown): Observable<never> {
  return throwError(() =>
    error instanceof HttpErrorResponse ? ApiError.fromHttpError(error) : error,
  );
}

/** Replaces `{name}` placeholders with encoded path parameters. */
export function buildPath(template: string, params: RawOptions['path'] = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}

/** Builds query parameters, leaving out `undefined` and `null` values. Arrays repeat the key. */
function buildParams(query: RawOptions['query'] = {}): HttpParams {
  let params = new HttpParams();
  for (const [key, raw] of Object.entries(query)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value !== undefined && value !== null) {
        params = params.append(key, String(value));
      }
    }
  }
  return params;
}
