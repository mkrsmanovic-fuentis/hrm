import { inject } from '@angular/core';
import { Router, type CanActivateFn, type Params } from '@angular/router';
import { AuthService } from './auth.service';

/** Path of the login page, without a leading slash. */
export const LOGIN_PATH = 'login';

/**
 * Only lets signed-in users through. Signed-out users, and users whose session has expired, go to
 * the login page, which brings them back to where they were after signing in.
 * Use it as `canActivate` and `canActivateChild`, so it runs on every navigation.
 */
export const signedInGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthService).hasValidSession()) return true;
  return inject(Router).createUrlTree([`/${LOGIN_PATH}`], {
    queryParams: returnUrlParams(state.url),
  });
};

/** Keeps signed-in users off the login page: they go to the home page instead. */
export const signedOutGuard: CanActivateFn = () => {
  if (!inject(AuthService).hasValidSession()) return true;
  return inject(Router).createUrlTree(['/']);
};

/** `returnUrl` for the login page, left out for the home page. */
export function returnUrlParams(url: string): Params {
  return url && url !== '/' ? { returnUrl: url } : {};
}

/**
 * Where to go after signing in: the `returnUrl` when it is a path inside the app, otherwise the
 * home page. Other origins are ignored, so a link cannot send users off the site.
 */
export function safeReturnUrl(returnUrl: string | null | undefined): string {
  if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) return '/';
  if (returnUrl.startsWith(`/${LOGIN_PATH}`)) return '/';
  return returnUrl;
}
