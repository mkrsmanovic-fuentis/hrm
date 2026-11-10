import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../api';
import { AuthService } from './auth.service';
import { LOGIN_PATH, returnUrlParams } from './auth-paths';

/**
 * Adds the session token to every API request, and on a `401` answer clears the session and
 * sends the user to the login page. A failed sign-in also answers `401`; that one is left to the
 * login page.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const baseUrl = inject(API_BASE_URL);
  if (!request.url.startsWith(baseUrl)) return next(request);

  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.token();
  const authorized =
    token && !request.headers.has('Authorization')
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !isSignIn(request, baseUrl)
      ) {
        auth.clear();
        const current = router.url;
        if (!current.startsWith(`/${LOGIN_PATH}`)) {
          void router.navigate([`/${LOGIN_PATH}`], { queryParams: returnUrlParams(current) });
        }
      }
      return throwError(() => error);
    }),
  );
};

function isSignIn(request: HttpRequest<unknown>, baseUrl: string): boolean {
  return request.method === 'POST' && request.url === `${baseUrl}/auth/session`;
}
