import { inject } from '@angular/core';
import {
  RedirectCommand,
  Router,
  type CanActivateFn,
  type RedirectFunction,
} from '@angular/router';
import type { RoleKey } from '../api';
import { homeUrl, LOGIN_PATH, NO_ACCESS_PATH, returnUrlParams } from './auth-paths';
import { AuthService } from './auth.service';

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

/** Keeps signed-in users off the login page: they go to their home page instead. */
export const signedOutGuard: CanActivateFn = () => {
  if (!inject(AuthService).hasValidSession()) return true;
  return inject(Router).createUrlTree(['/']);
};

/**
 * Only lets users with this role through. Anyone else sees the "no access" page, and the address
 * bar keeps the URL they opened. Signed-out users go to the login page.
 *
 * Put it on a role's area as `canActivate` and `canActivateChild`, so it covers every page in the
 * area. Pages added to the area need no guard of their own.
 *
 * @example
 * { path: 'admin', canActivate: [roleGuard('administrator')], canActivateChild: [roleGuard('administrator')], children: [...] }
 */
export function roleGuard(role: RoleKey): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    if (!auth.hasValidSession()) {
      return router.createUrlTree([`/${LOGIN_PATH}`], { queryParams: returnUrlParams(state.url) });
    }
    if (auth.role() === role) return true;
    // Show the no-access page, while the address bar shows the URL the user opened.
    return new RedirectCommand(router.parseUrl(`/${NO_ACCESS_PATH}`), { browserUrl: state.url });
  };
}

/** Redirect for `/`: the signed-in user's home page, or the login page when signed out. */
export const roleHomeRedirect: RedirectFunction = () => {
  const auth = inject(AuthService);
  const role = auth.hasValidSession() ? auth.role() : null;
  return role ? homeUrl(role) : `/${LOGIN_PATH}`;
};
