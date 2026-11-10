import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../api';
import { AuthService } from './auth.service';

/**
 * Adds the session token to every API request, and on a `401` answer ends the session, which
 * opens the login page (see `AuthService.endSession`). A failed sign-in also answers `401`; that
 * one is left to the login page. Other errors, such as `403`, keep the session.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const baseUrl = inject(API_BASE_URL);
  if (!request.url.startsWith(baseUrl)) return next(request);

  const auth = inject(AuthService);
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
        auth.endSession();
      }
      return throwError(() => error);
    }),
  );
};

function isSignIn(request: HttpRequest<unknown>, baseUrl: string): boolean {
  return request.method === 'POST' && request.url === `${baseUrl}/auth/session`;
}
