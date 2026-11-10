import { InjectionToken, type Provider } from '@angular/core';
import type { SdNavItem } from '@specora-dev/ui-kit';
import type { RoleKey } from '../api';

/**
 * One entry in the shell's side navigation. A feature adds exactly one of these to
 * `src/app/app.navigation.ts` when its page exists.
 */
export interface AppNavItem {
  /** Text of the entry, for example "Departments". */
  label: string;
  /** A Lucide icon, for example `LucideBuilding2`. */
  icon: NonNullable<SdNavItem['icon']>;
  /** Absolute URL of the page. It must be inside the role's area, for example `/admin/departments`. */
  route: string;
  /** The only role that sees the entry. It must match the role guard of the route's area. */
  role: RoleKey;
  /** Optional section header, shown above the first entry of each run of equal values. */
  section?: string;
}

/** The app's navigation entries for every role. Provided once in `app.config.ts`. */
export const NAV_ITEMS = new InjectionToken<readonly AppNavItem[]>('NAV_ITEMS', {
  providedIn: 'root',
  factory: () => [],
});

/** Provides the navigation entries the shell shows. */
export function provideNavigation(items: readonly AppNavItem[]): Provider {
  return { provide: NAV_ITEMS, useValue: items };
}

/** The entries one role sees, in order, ready for `sd-sidenav`. Signed out sees none. */
export function navItemsFor(items: readonly AppNavItem[], role: RoleKey | null): SdNavItem[] {
  if (!role) return [];
  return items
    .filter((item) => item.role === role)
    .map(({ label, icon, route, section }) => ({
      label,
      icon,
      route,
      ...(section ? { section } : {}),
    }));
}
