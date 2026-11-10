/*
 * Access rules the mock applies, mirrored from the "Access by role" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { RoleKey, Topic, User } from '../../app/core/api/api-schema.gen';

/** Whether the user has one of the roles. */
export function hasRole(user: Pick<User, 'role'>, roles: readonly RoleKey[]): boolean {
  return roles.includes(user.role);
}

/**
 * Own data only: administrators can read every user's records, employees only their own.
 * `ownerId` is the user the record belongs to, for example an assignment's `userId`.
 */
export function canReadOwnedRecord(user: Pick<User, 'id' | 'role'>, ownerId: string): boolean {
  return user.role === 'administrator' || user.id === ownerId;
}

/** Administrators see every topic. Employees see only active topics. */
export function canSeeTopic(user: Pick<User, 'role'>, topic: Pick<Topic, 'status'>): boolean {
  return user.role === 'administrator' || topic.status === 'active';
}
