import type { Location } from '@angular/common';
import type { Params, UrlTree } from '@angular/router';
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

/**
 * The URL in the address bar, for example `/admin/home?page=2`. Use it, not `router.url`, for a
 * `returnUrl`: on the no-access page the router's URL is `/no-access`, while the address bar
 * still shows the page the user opened.
 */
export function addressBarUrl(location: Location): string {
  return location.path() || '/';
}

/** Whether the URL is the login page, with or without a query. */
export function isLoginPage(url: UrlTree): boolean {
  return url.root.children['primary']?.segments[0]?.path === LOGIN_PATH;
}

/** `returnUrl` for the login page, left out for the home page. */
export function returnUrlParams(url: string): Params {
  return url && url !== '/' ? { returnUrl: url } : {};
}

/**
 * Where to go after signing in: the `returnUrl` when it is a path inside the app, otherwise `/`,
 * which opens the role's home page. Other origins are ignored, so a link cannot send users off
 * the site. With a `role`, a `returnUrl` in another role's area also leads to `/`, so a user who
 * signs in where someone else's session ended lands on their own home, not on "No access".
 */
export function safeReturnUrl(returnUrl: string | null | undefined, role?: RoleKey | null): string {
  if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//')) return '/';
  if (isUnder(returnUrl, LOGIN_PATH) || isUnder(returnUrl, NO_ACCESS_PATH)) return '/';
  if (role) {
    const otherAreas = Object.entries(ROLE_AREAS).filter(([key]) => key !== role);
    if (otherAreas.some(([, area]) => isUnder(returnUrl, area))) return '/';
  }
  return returnUrl;
}

/** Whether the URL is `/<segment>` or below it, with or without a query or fragment. */
function isUnder(url: string, segment: string): boolean {
  const first = url.slice(1).split(/[/?#]/, 1)[0];
  return first === segment;
}
