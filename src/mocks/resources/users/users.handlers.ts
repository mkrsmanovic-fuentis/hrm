import type { User } from '../../../app/core/api/api-schema.gen';
import { recordAudit } from '../../db/audit';
import type { MockDb } from '../../db/mock-db';
import type { UserRecord } from '../../db/mock-data';
import { canResendInvitation, hasPassword } from '../../rules/auth-rules';
import {
  fullName,
  isSameEmail,
  isValidEmail,
  matchesUserSearch,
  toUser,
  USER_EMAIL_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
} from '../../rules/user-rules';
import { requireRole } from '../../support/access';
import { issueLink, removeLinks } from '../../support/account-links';
import { demoLinkHeader } from '../../support/auth';
import { BodyReader, notUnique } from '../../support/body';
import { route } from '../../support/mock-route';
import { MockProblem } from '../../support/problem';
import { sortBy } from '../../support/query';

const STATUSES = ['active', 'inactive'] as const;
const ROLES = ['administrator', 'employee'] as const;
const SORTS = [
  'name',
  '-name',
  'email',
  '-email',
  'assignedTrainingCount',
  '-assignedTrainingCount',
  'completedTrainingCount',
  '-completedTrainingCount',
  'createdAt',
  '-createdAt',
] as const;
/** IDs are UUIDs; anything longer is not one. */
const ID_MAX_LENGTH = 100;

const sortFields = {
  name: (user: User) => fullName(user),
  email: (user: User) => user.email,
  assignedTrainingCount: (user: User) => user.assignedTrainingCount,
  completedTrainingCount: (user: User) => user.completedTrainingCount,
  createdAt: (user: User) => Date.parse(user.createdAt),
};

/**
 * Mock handlers for the Users tag in the spec: the Employees page. Administrators only, like the
 * department handlers they copy. On top of that pattern:
 *
 * - Emails are unique, ignoring case and spaces around them (`409` on `email`).
 * - Only an active department can be chosen; a user keeps an inactive one they already have.
 * - A new user gets an invite: `invitationSentAt` now, `invitationExpiresAt` 7 days later. The
 *   demo-only `X-Demo-Link` header carries the link, which the real backend emails instead.
 * - `POST /users/{userId}/invitation` sends a new invite and makes the old link stop working. Not
 *   audit-logged (SPE-46).
 * - Changing the email of an active user without a password sends a new invite to the new address.
 *   Changing anyone's email removes their reset links.
 * - Administrators cannot deactivate themselves or change their own role (`409`).
 * - Deactivating ends the user's sessions. `authenticate()` also rejects inactive users.
 */
export const userRoutes = [
  route.get('/users', (ctx) => {
    requireRole(ctx, 'administrator');
    const { db, now, query, page, ok, validationFailed } = ctx;
    const pagination = query.pagination();
    const status = query.oneOf('status', STATUSES);
    const role = query.oneOf('role', ROLES);
    const departmentId = query.text('departmentId', { maxLength: ID_MAX_LENGTH });
    const search = query.text('q', { maxLength: USER_EMAIL_MAX_LENGTH });
    const sort = query.oneOf('sort', SORTS, 'name');
    if (query.errors.length > 0) return validationFailed(query.errors);

    const users = db.data.users
      .filter((user) => !status || user.status === status)
      .filter((user) => !role || user.role === role)
      .filter((user) => !departmentId || user.departmentId === departmentId)
      .filter((user) => !search || matchesUserSearch(user, search))
      .map((user) => toUser(user, db.data, now));
    return ok(page(sortBy(users, sort, sortFields), pagination));
  }),

  route.post('/users', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, now, ok, validationFailed } = ctx;
    const body = new BodyReader(await ctx.json(), [
      'email',
      'firstName',
      'lastName',
      'role',
      'departmentId',
    ]);
    const email = body.email('email', {
      required: true,
      maxLength: USER_EMAIL_MAX_LENGTH,
      isValid: isValidEmail,
    });
    const firstName = body.text('firstName', { required: true, maxLength: USER_NAME_MAX_LENGTH });
    const lastName = body.text('lastName', { required: true, maxLength: USER_NAME_MAX_LENGTH });
    const role = body.oneOf('role', ROLES, { required: true });
    const departmentId = body.nullableId('departmentId');
    if (departmentId) checkDepartment(db, body, departmentId, null);
    if (
      body.errors.length > 0 ||
      email === undefined ||
      firstName === undefined ||
      lastName === undefined ||
      role === undefined
    ) {
      return validationFailed(body.errors);
    }
    requireUniqueEmail(db, email);

    const created = db.update((data) => {
      const at = now.toISOString();
      const user: UserRecord = {
        id: crypto.randomUUID(),
        organizationId: data.organization.id,
        email,
        firstName,
        lastName,
        role,
        departmentId: departmentId ?? null,
        status: 'active',
        // Set by issueLink() below, 7 days apart.
        invitationSentAt: null,
        invitationExpiresAt: null,
        passwordSetAt: null,
        lastSignedInAt: null,
        createdAt: at,
        updatedAt: at,
      };
      data.users.push(user);
      const link = issueLink(data, user, 'invitation', now);
      recordAudit(data, {
        action: 'created',
        entityType: 'user',
        actorId: admin.id,
        now,
        after: user,
      });
      return { user, link };
    });
    return ok(toUser(created.user, db.data, now), 201, demoLinkHeader(ctx, created.link));
  }),

  route.post('/users/{userId}/invitation', (ctx) => {
    requireRole(ctx, 'administrator');
    const { db, params, now, ok, notFound } = ctx;
    const user = db.data.users.find((u) => u.id === params.userId);
    if (!user) return notFound(`User ${params.userId} was not found.`);
    if (!canResendInvitation(user)) {
      throw new MockProblem(
        409,
        hasPassword(user)
          ? `${fullName(user)} has set a password already.`
          : `${fullName(user)} is deactivated. Reactivate them before sending the invite again.`,
      );
    }
    // Not audit-logged: whether resending is logged is open for the PO (SPE-46).
    const link = db.update((data) => issueLink(data, user, 'invitation', now));
    return ok(toUser(user, db.data, now), 201, demoLinkHeader(ctx, link));
  }),

  route.get('/users/{userId}', (ctx) => {
    requireRole(ctx, 'administrator');
    const { db, now, params, ok, notFound } = ctx;
    const user = db.data.users.find((u) => u.id === params.userId);
    return user ? ok(toUser(user, db.data, now)) : notFound(`User ${params.userId} was not found.`);
  }),

  route.patch('/users/{userId}', async (ctx) => {
    const admin = requireRole(ctx, 'administrator');
    const { db, params, now, ok, notFound, validationFailed } = ctx;
    const user = db.data.users.find((u) => u.id === params.userId);
    if (!user) return notFound(`User ${params.userId} was not found.`);

    const body = new BodyReader(await ctx.json(), [
      'email',
      'firstName',
      'lastName',
      'role',
      'departmentId',
      'status',
    ]);
    const email = body.email('email', { maxLength: USER_EMAIL_MAX_LENGTH, isValid: isValidEmail });
    const firstName = body.text('firstName', { maxLength: USER_NAME_MAX_LENGTH });
    const lastName = body.text('lastName', { maxLength: USER_NAME_MAX_LENGTH });
    const role = body.oneOf('role', ROLES);
    const departmentId = body.nullableId('departmentId');
    if (departmentId) checkDepartment(db, body, departmentId, user.departmentId);
    const status = body.oneOf('status', STATUSES);
    if (body.errors.length > 0) return validationFailed(body.errors);

    if (user.id === admin.id) {
      if (status === 'inactive') {
        throw new MockProblem(409, 'You cannot deactivate your own account.');
      }
      if (role !== undefined && role !== user.role) {
        throw new MockProblem(409, 'You cannot change your own role.');
      }
    }
    if (email !== undefined) requireUniqueEmail(db, email, user.id);

    const changes: Partial<UserRecord> = {
      ...(email !== undefined && { email }),
      ...(firstName !== undefined && { firstName }),
      ...(lastName !== undefined && { lastName }),
      ...(role !== undefined && { role }),
      ...(departmentId !== undefined && { departmentId }),
      ...(status !== undefined && { status }),
    };
    const result = db.update((data) => {
      const before = structuredClone(user);
      Object.assign(user, changes);
      // Logs `updated` for the other fields, and `deactivated` or `reactivated` for status.
      const entries = recordAudit(data, {
        action: 'updated',
        entityType: 'user',
        actorId: admin.id,
        now,
        before,
        after: user,
      });
      if (entries.length > 0) user.updatedAt = now.toISOString();
      // Deactivating ends the user's sessions at once and makes their invite and reset links stop
      // working. Reactivating brings neither back: send the invite again if needed.
      if (user.status === 'inactive') {
        data.sessions = data.sessions.filter((session) => session.userId !== user.id);
        removeLinks(data, user.id);
      }
      if (isSameEmail(before.email, user.email)) return { user, invite: null };
      // A reset link went to the old address, so a new email makes it stop working.
      removeLinks(data, user.id, 'password_reset');
      // An active user who has not set a password gets a new invite at the new address at once:
      // the old link stops working, and the new one is valid for 7 days. Not audit-logged (SPE-46);
      // the email change itself is logged above, before the invite fields change.
      const invite = canResendInvitation(user) ? issueLink(data, user, 'invitation', now) : null;
      return { user, invite };
    });
    return ok(
      toUser(result.user, db.data, now),
      200,
      result.invite ? demoLinkHeader(ctx, result.invite) : undefined,
    );
  }),
];

/**
 * Only an active department can be chosen. `currentId` is the user's department before the
 * change: a user keeps an inactive department they already have.
 */
function checkDepartment(
  db: MockDb,
  body: BodyReader,
  departmentId: string,
  currentId: string | null,
): void {
  const department = db.data.departments.find((d) => d.id === departmentId);
  if (!department) {
    body.invalid('departmentId', 'Choose a department that exists.');
  } else if (department.status !== 'active' && department.id !== currentId) {
    body.invalid('departmentId', 'Choose an active department.');
  }
}

/** Answers `409` when another user already has the email. */
function requireUniqueEmail(db: MockDb, email: string, exceptId?: string): void {
  const taken = db.data.users.some(
    (other) => other.id !== exceptId && isSameEmail(other.email, email),
  );
  if (taken) {
    throw notUnique(
      'email',
      'A user with this email already exists.',
      `A user with the email ${email} already exists.`,
    );
  }
}
