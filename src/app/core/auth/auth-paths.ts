import type { Params } from '@angular/router';
import type { RoleKey } from '../api';

/** Path of the login page, without a leading slash. */
export const LOGIN_PATH = 'login';

/** Path of the "no access" page, without a leading slash. The role guard shows it. */
export const NO_ACCESS_PATH = 'no-access';

/**
 * The first URL segment of each role's area. Every administrator page lives under `/admin`, every
 * employee page under `/my`. The role guard on each area keeps the other role out.
 */
export const ROLE_AREAS: Record<RoleKey, string> = {
  administrator: 'admin',
  employee: 'my',
};

/** Where a role lands after signing in. `/` and the brand link in the top bar lead here too. */
export function homeUrl(role: RoleKey): string {
  return `/${ROLE_AREAS[role]}/home`;
}

/** `returnUrl` for the login page, left out for the home page. */
export function returnUrlParams(url: string): Params {
  return url && url !== '/' ? { returnUrl: url } : {};
}

/**
 * Where to go after signing in: the `returnUrl` when it is a path inside the app, otherwise `/`,
 * which opens the role's home page. Other origins are ignored, so a link cannot send users off
 * the site.
 */
export function safeReturnUrl(returnUrl: string | null | undefined): string {
  if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) return '/';
  if (returnUrl.startsWith(`/${LOGIN_PATH}`)) return '/';
  return returnUrl;
}
