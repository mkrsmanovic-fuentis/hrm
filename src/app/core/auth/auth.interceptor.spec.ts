import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../api';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

@Component({ template: '' })
class Blank {}

describe('authInterceptor', () => {
  function setup(token: string | null = 'token-123') {
    const auth = { token: signal(token), endSession: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', component: Blank }]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: '/api/v1' },
        { provide: AuthService, useValue: auth },
      ],
    });
    return {
      auth,
      http: TestBed.inject(HttpClient),
      backend: TestBed.inject(HttpTestingController),
      router: TestBed.inject(Router),
    };
  }

  function unauthorized() {
    return [
      { type: '/problems/unauthenticated', title: 'Not signed in', status: 401 },
      { status: 401, statusText: 'Unauthorized' },
    ] as const;
  }

  it('adds the session token to API requests', () => {
    const { http, backend } = setup();

    http.get('/api/v1/topics').subscribe();

    const request = backend.expectOne('/api/v1/topics');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-123');
    request.flush({});
  });

  it('sends no token when signed out, and none to other URLs', () => {
    const { http, backend } = setup();
    http.get('/assets/logo.svg').subscribe();
    backend.expectOne('/assets/logo.svg').flush('');
    expect(backend.match(() => true)).toEqual([]);

    TestBed.resetTestingModule();
    const signedOut = setup(null);
    signedOut.http.get('/api/v1/topics').subscribe();
    const request = signedOut.backend.expectOne('/api/v1/topics');
    expect(request.request.headers.has('Authorization')).toBe(false);
  });

  it('ends the session on 401, which opens the login page', async () => {
    const { auth, http, backend } = setup();

    const result = firstValueFrom(http.get('/api/v1/topics')).catch((e: unknown) => e);
    backend.expectOne('/api/v1/topics').flush(...unauthorized());

    expect(await result).toMatchObject({ status: 401 });
    expect(auth.endSession).toHaveBeenCalledTimes(1);
  });

  it('leaves a failed sign-in to the login page', async () => {
    const { auth, http, backend, router } = setup(null);
    await router.navigateByUrl('/login');

    const result = firstValueFrom(http.post('/api/v1/auth/session', {})).catch((e: unknown) => e);
    backend.expectOne('/api/v1/auth/session').flush(...unauthorized());

    expect(await result).toMatchObject({ status: 401 });
    expect(auth.endSession).not.toHaveBeenCalled();
    expect(router.url).toBe('/login');
  });

  it('keeps the session on other errors, such as 403', async () => {
    const { auth, http, backend } = setup();

    const result = firstValueFrom(http.get('/api/v1/topics')).catch((e: unknown) => e);
    backend
      .expectOne('/api/v1/topics')
      .flush(
        { type: '/problems/forbidden', title: 'Access denied', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );

    expect(await result).toMatchObject({ status: 403 });
    expect(auth.endSession).not.toHaveBeenCalled();
  });
});
