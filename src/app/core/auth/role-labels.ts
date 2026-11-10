import type { RoleKey } from '../api';

/** Display names of the roles, as shown in the top bar and the user menu. */
export const ROLE_LABELS: Record<RoleKey, string> = {
  administrator: 'Administrator',
  employee: 'Employee',
};
