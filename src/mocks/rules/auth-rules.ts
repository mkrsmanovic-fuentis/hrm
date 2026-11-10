/*
 * Sign-in and session rules the mock applies, mirrored from the "Sign-in and sessions" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { User } from '../../app/core/api/api-schema.gen';

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
