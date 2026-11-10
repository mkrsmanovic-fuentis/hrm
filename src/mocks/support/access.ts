import type { RoleKey, User } from '../../app/core/api/api-schema.gen';
import { canReadOwnedRecord, hasRole } from '../rules/access-rules';
import { MockProblem } from './problem';

/** The part of a handler's context the access helpers read. */
interface AccessContext {
  currentUser: User | null;
}

/**
 * Lets the request through only for users with one of the roles, and returns the signed-in user.
 * Anyone else gets `403` with type `/problems/forbidden`. Call it first in the handler, before
 * reading the body or the database.
 *
 * @example
 * route.post('/departments', async (ctx) => {
 *   const admin = requireRole(ctx, 'administrator');
 *   // ... validate, then db.update() and recordAudit() with actorId: admin.id
 * }),
 */
export function requireRole(ctx: AccessContext, ...roles: [RoleKey, ...RoleKey[]]): User {
  const user = signedInUser(ctx);
  if (!hasRole(user, roles)) {
    throw new MockProblem(403, 'You do not have permission to do this.');
  }
  return user;
}

/**
 * Own data only, for lists: keeps the records the signed-in user may read. Administrators keep
 * all of them; employees keep only their own.
 *
 * @example
 * const assignments = ownRecords(ctx, db.data.assignments, (a) => a.userId);
 */
export function ownRecords<T>(
  ctx: AccessContext,
  records: readonly T[],
  ownerOf: (record: T) => string,
): T[] {
  const user = signedInUser(ctx);
  return records.filter((record) => canReadOwnedRecord(user, ownerOf(record)));
}

/**
 * Own data only, for one record: returns it when the signed-in user may read it. A record that
 * does not exist, or belongs to another employee, answers `404`, so employees cannot find out
 * which IDs exist.
 *
 * @example
 * const assignment = requireOwnRecord(
 *   ctx,
 *   db.data.assignments.find((a) => a.id === params.assignmentId),
 *   (a) => a.userId,
 *   `Assignment ${params.assignmentId} was not found.`,
 * );
 */
export function requireOwnRecord<T>(
  ctx: AccessContext,
  record: T | undefined,
  ownerOf: (record: T) => string,
  notFoundDetail?: string,
): T {
  const user = signedInUser(ctx);
  if (record === undefined || !canReadOwnedRecord(user, ownerOf(record))) {
    throw new MockProblem(404, notFoundDetail);
  }
  return record;
}

/**
 * The signed-in user. Every route that is not public has one; on a public route this answers
 * `401`.
 */
export function signedInUser(ctx: AccessContext): User {
  if (!ctx.currentUser) throw new MockProblem(401);
  return ctx.currentUser;
}
