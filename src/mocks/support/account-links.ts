import { ProblemType } from '../../app/core/api/api-error';
import type { AccountLinkPurpose, AccountLinkRecord, MockData, UserRecord } from '../db/mock-data';
import { isLinkActive } from '../rules/auth-rules';
import { INVITATION_LIFETIME_MS, PASSWORD_RESET_LIFETIME_MS } from '../rules/training-rules';
import { newLinkToken } from './auth';
import { MockProblem } from './problem';

const LIFETIME_MS: Record<AccountLinkPurpose, number> = {
  invitation: INVITATION_LIFETIME_MS,
  password_reset: PASSWORD_RESET_LIFETIME_MS,
};

/**
 * Creates a new invite or password reset link for the user, valid for 7 days or 1 hour. Every
 * earlier link of the same purpose stops working: it is removed, so it answers "not found". Call
 * it inside `db.update()`.
 *
 * A new invite also sets the user's `invitationSentAt` and `invitationExpiresAt`.
 */
export function issueLink(
  data: MockData,
  user: UserRecord,
  purpose: AccountLinkPurpose,
  now: Date,
): AccountLinkRecord {
  removeLinks(data, user.id, purpose);
  const link: AccountLinkRecord = {
    token: newLinkToken(),
    userId: user.id,
    purpose,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LIFETIME_MS[purpose]).toISOString(),
    usedAt: null,
  };
  data.accountLinks.push(link);
  if (purpose === 'invitation') {
    user.invitationSentAt = link.createdAt;
    user.invitationExpiresAt = link.expiresAt;
  }
  return link;
}

/**
 * The link for a token and its user, or a problem:
 *
 * - `404 /problems/link-not-found`: unknown token, a link replaced by a newer one, or a user who
 *   was deactivated.
 * - `410 /problems/link-used`: the link was used already. An invite of a user who has a password
 *   counts as used.
 * - `410 /problems/link-expired`: past `expiresAt`.
 */
export function requireLink(
  data: MockData,
  token: string,
  purpose: AccountLinkPurpose,
  now: Date,
): { link: AccountLinkRecord; user: UserRecord } {
  const link = data.accountLinks.find((l) => l.token === token && l.purpose === purpose);
  const user = link && data.users.find((u) => u.id === link.userId);
  if (!link || !user || user.status !== 'active') {
    throw new MockProblem(
      404,
      'This link is not valid. It may have been replaced by a newer one.',
      undefined,
      undefined,
      {
        type: ProblemType.linkNotFound,
        title: 'Link not valid',
      },
    );
  }
  if (link.usedAt !== null || (purpose === 'invitation' && user.passwordSetAt !== null)) {
    throw new MockProblem(410, 'This link was used already.', undefined, undefined, {
      type: ProblemType.linkUsed,
      title: 'Link used',
    });
  }
  if (!isLinkActive(link, now)) {
    throw new MockProblem(410, 'This link has expired.', undefined, undefined, {
      type: ProblemType.linkExpired,
      title: 'Link expired',
    });
  }
  return { link, user };
}

/**
 * Sets the user's password through a link: saves its hash, uses up the link, removes the user's
 * other links of the same purpose and sets `passwordSetAt`. An invite also clears the invitation
 * fields. Call it inside `db.update()`, with the hash from `hashPassword()`.
 */
export function setPasswordThroughLink(
  data: MockData,
  link: AccountLinkRecord,
  user: UserRecord,
  passwordHash: string,
  now: Date,
): void {
  data.credentials = data.credentials.filter((c) => c.userId !== user.id);
  data.credentials.push({ userId: user.id, passwordHash });
  removeLinks(data, user.id, link.purpose, link);
  link.usedAt = now.toISOString();
  user.passwordSetAt = now.toISOString();
  if (link.purpose === 'invitation') {
    user.invitationSentAt = null;
    user.invitationExpiresAt = null;
  }
}

/**
 * Makes the user's links stop working: those of one purpose, or all of them. `keep` stays. Call it
 * inside `db.update()`. A removed link answers "not found".
 */
export function removeLinks(
  data: MockData,
  userId: string,
  purpose?: AccountLinkPurpose,
  keep?: AccountLinkRecord,
): void {
  data.accountLinks = data.accountLinks.filter(
    (l) => l === keep || l.userId !== userId || (purpose !== undefined && l.purpose !== purpose),
  );
}
