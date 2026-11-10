import { LucideBuilding2, LucideHouse, LucideUsers } from '@lucide/angular';
import { homeUrl } from './core/auth';
import type { AppNavItem } from './core/navigation';

/**
 * The side navigation, for every role. Each user sees only the entries for their role, in this
 * order.
 *
 * A feature adds one entry here when its page exists, never before: a label, an icon, the page's
 * route and the role that may open it. The route must be a page in that role's area in
 * `app.routes.ts` (`/admin/...` or `/my/...`); a test checks this.
 *
 * @example
 * { label: 'Departments', icon: LucideBuilding2, route: '/admin/departments', role: 'administrator' },
 */
export const navigation: AppNavItem[] = [
  { label: 'Home', icon: LucideHouse, route: homeUrl('administrator'), role: 'administrator' },
  { label: 'Employees', icon: LucideUsers, route: '/admin/employees', role: 'administrator' },
  {
    label: 'Departments',
    icon: LucideBuilding2,
    route: '/admin/departments',
    role: 'administrator',
  },
  { label: 'Home', icon: LucideHouse, route: homeUrl('employee'), role: 'employee' },
];
