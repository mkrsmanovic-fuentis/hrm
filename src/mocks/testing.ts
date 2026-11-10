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
import { createHandlers } from './handlers';
import { buildSeed, SEED_VERSION } from './seed/seed';
import type { SimulationFlags } from './support/simulation';

/** Fixed "now" for tests, so dates and statuses in the seed are stable. */
export const TEST_NOW = new Date('2026-11-10T12:00:00Z');

export interface TestMockApiOptions {
  now?: Date;
  flags?: SimulationFlags;
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
  const db = new MockDb({ seed: () => buildSeed(now), storage: null, version: SEED_VERSION });
  const handlers = createHandlers({
    db,
    baseUrl: environment.apiBaseUrl,
    flags: () => options.flags ?? {},
    latency: 0,
    now: () => now,
  });
  const providers: Provider[] = [{ provide: HttpBackend, useValue: new MockHttpBackend(handlers) }];

  return {
    db,
    handlers,
    /** Add after `provideHttpClient()` so HttpClient sends requests to the mock handlers. */
    providers,
    /** Sends a request straight to the handlers, for handler tests without Angular. */
    fetch: (path: string, init?: RequestInit) =>
      getResponse(handlers, new Request(new URL(path, 'http://localhost'), init)).then(
        (response) =>
          response ?? new Response(null, { status: 599, statusText: 'No mock handler' }),
      ),
  };
}

/** An Angular HttpBackend that answers requests with MSW handlers, without a network or service worker. */
export class MockHttpBackend implements HttpBackend {
  constructor(private readonly handlers: HttpHandler[]) {}

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

      getResponse(this.handlers, request)
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
