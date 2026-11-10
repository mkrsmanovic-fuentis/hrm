/*
 * User and employee rules the mock applies, mirrored from the "Users and employees" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { Attempt, User } from '../../app/core/api/api-schema.gen';
import type { AssignmentRecord, UserRecord } from '../db/mock-data';
import { sameEmail } from './auth-rules';
import { assignmentStatus } from './training-rules';

export const USER_EMAIL_MAX_LENGTH = 254;
export const USER_NAME_MAX_LENGTH = 100;

/**
 * A simple email check: something before and after one `@`, a dot in the domain and no spaces.
 * The real backend may check more strictly.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Emails are unique within the organization, among active and inactive users, ignoring upper and
 * lower case and spaces around them. Sign-in matches them the same way.
 */
export const isSameEmail = sameEmail;

/**
 * Text as `q` compares it: lower case, with typographic apostrophes (’ ‘ ʼ) as a plain `'`, so
 * "o'neill" finds "O’Neill".
 */
export function searchKey(text: string): string {
  return text.toLowerCase().replace(/[‘’ʼ]/g, "'");
}

/** `q` matches the full name or the email. */
export function matchesUserSearch(
  user: Pick<User, 'firstName' | 'lastName' | 'email'>,
  query: string,
): boolean {
  const key = searchKey(query);
  return searchKey(fullName(user)).includes(key) || searchKey(user.email).includes(key);
}

/** The user's full name, as the app shows it and `sort=name` orders it: first name first. */
export function fullName(user: Pick<User, 'firstName' | 'lastName'>): string {
  return `${user.firstName} ${user.lastName}`;
}

/**
 * The derived training counts of a user.
 *
 * - `assignedTrainingCount`: every assignment the user has received, in any status. A deactivated
 *   user's open assignments still count: deactivating leaves assignments unchanged.
 * - `completedTrainingCount`: the assignments whose status is `passed`, late passes included.
 *
 * Neither depends on the time, because a passed assignment stays passed.
 */
export function trainingCounts(
  userId: string,
  assignments: readonly AssignmentRecord[],
  attempts: readonly Attempt[],
  now: Date,
): Pick<User, 'assignedTrainingCount' | 'completedTrainingCount'> {
  const own = assignments.filter((assignment) => assignment.userId === userId);
  const completed = own.filter(
    (assignment) =>
      assignmentStatus(
        assignment.dueAt,
        attempts.filter((attempt) => attempt.assignmentId === assignment.id),
        now,
      ) === 'passed',
  );
  return { assignedTrainingCount: own.length, completedTrainingCount: completed.length };
}

/** The API's `User`: the stored record plus its derived training counts. */
export function toUser(
  record: UserRecord,
  data: { assignments: readonly AssignmentRecord[]; attempts: readonly Attempt[] },
  now: Date,
): User {
  return { ...record, ...trainingCounts(record.id, data.assignments, data.attempts, now) };
}

/**
 * Whether the user's open assignments count as pending and overdue, for example in reports and
 * dashboards. A deactivated user's open assignments stay unchanged but are left out of those
 * counts; reactivating the user brings them back.
 */
export function countsInPendingAndOverdue(user: Pick<User, 'status'>): boolean {
  return user.status === 'active';
}
