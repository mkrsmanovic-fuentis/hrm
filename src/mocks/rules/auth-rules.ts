/*
 * Sign-in and session rules the mock applies, mirrored from the "Sign-in and sessions" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { InvitationStatus, User } from '../../app/core/api/api-schema.gen';

/** A session lasts 8 hours from sign-in. Activity does not extend it. */
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

/**
 * Whether the user has a password to sign in with. Users whose invite is still pending (or has
 * expired) have not set one yet.
 */
export function hasPassword(user: Pick<User, 'passwordSetAt'>): boolean {
  return user.passwordSetAt !== null;
}

/** Emails are matched without regard to upper and lower case, and surrounding spaces are ignored. */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Whether a session is still valid at `now`. It ends exactly at `expiresAt`. */
export function isSessionActive(session: { expiresAt: string }, now: Date): boolean {
  return Date.parse(session.expiresAt) > now.getTime();
}

/*
 * Invite link, password reset and password rules, mirrored from the "Invite links and password
 * resets" and "Passwords" sections of docs/developer-guide/business-rules.mdx.
 */

/** A new password has at least 12 characters. */
export const PASSWORD_MIN_LENGTH = 12;
/** A new password has at most 128 characters. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * The length of a password in characters, counted as Unicode code points, as JSON Schema's
 * `minLength` counts them: an emoji is one character, not two UTF-16 units.
 */
export function passwordLength(password: string): number {
  return [...password].length;
}

/**
 * Why a new password is not allowed, or null when it is. Passwords are not trimmed: spaces count
 * like any other character. There are no rules on kinds of characters; length matters most.
 */
export function passwordProblem(
  password: string,
  email: string,
): { code: 'too_short' | 'too_long' | 'invalid_value'; message: string } | null {
  const length = passwordLength(password);
  if (length < PASSWORD_MIN_LENGTH) {
    return { code: 'too_short', message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return { code: 'too_long', message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (sameEmail(password, email)) {
    return { code: 'invalid_value', message: 'Do not use your email address as your password.' };
  }
  return null;
}

/**
 * Where a user's invite stands: `accepted` once they have set a password, otherwise `pending`
 * until `invitationExpiresAt`, then `expired`.
 */
export function invitationStatus(
  user: Pick<User, 'passwordSetAt' | 'invitationExpiresAt'>,
  now: Date,
): InvitationStatus {
  if (user.passwordSetAt !== null) return 'accepted';
  const expiresAt = user.invitationExpiresAt ? Date.parse(user.invitationExpiresAt) : 0;
  return expiresAt > now.getTime() ? 'pending' : 'expired';
}

/** Whether an administrator may send the invite again: active users without a password only. */
export function canResendInvitation(user: Pick<User, 'status' | 'passwordSetAt'>): boolean {
  return user.status === 'active' && !hasPassword(user);
}

/**
 * Whether a user may get a password reset link: the users who can sign in, that is active users
 * who have set a password. Everyone else gets the same neutral answer, and no link.
 */
export function canResetPassword(user: Pick<User, 'status' | 'passwordSetAt'>): boolean {
  return user.status === 'active' && hasPassword(user);
}

/** Whether an invite or reset link is still valid at `now`. It ends exactly at `expiresAt`. */
export function isLinkActive(link: { expiresAt: string }, now: Date): boolean {
  return Date.parse(link.expiresAt) > now.getTime();
}
