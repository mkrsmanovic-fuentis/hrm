import type { Session } from '../../app/core/api/api-schema.gen';
import type {
  AccountLinkPurpose,
  AccountLinkRecord,
  MockData,
  SessionRecord,
  UserRecord,
} from '../db/mock-data';
import { isSessionActive, SESSION_LIFETIME_MS } from '../rules/auth-rules';
import { toUser } from '../rules/user-rules';

/** The bearer token from the `Authorization` header, or null when there is none. */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

/** Result of checking a request's session token. */
export type Authentication =
  { ok: true; session: SessionRecord; user: UserRecord } | { ok: false; detail: string };

/**
 * Checks the request's session token, as every endpoint except sign-in and sign-out does. The
 * token must belong to a session that has not expired, of a user who is still active: deactivating
 * a user ends their sessions at once, so their next request gets `401`.
 */
export function authenticate(data: MockData, request: Request, now: Date): Authentication {
  const token = readBearerToken(request);
  if (!token) return { ok: false, detail: 'Sign in to continue.' };

  const session = data.sessions.find((s) => s.token === token);
  const user = session && data.users.find((u) => u.id === session.userId);
  if (!session || !user) {
    return { ok: false, detail: 'The session is not valid. Sign in again.' };
  }
  if (!isSessionActive(session, now)) {
    return { ok: false, detail: 'The session has expired. Sign in again.' };
  }
  if (user.status !== 'active') {
    return { ok: false, detail: 'This account is deactivated, so its session has ended.' };
  }
  return { ok: true, session, user };
}

/** The API shape of a stored session, with the signed-in user as the API shows it. */
export function toSession(
  session: SessionRecord,
  user: UserRecord,
  data: MockData,
  now: Date,
): Session {
  return {
    token: session.token,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    user: toUser(user, data, now),
  };
}

/**
 * Starts a session for the user, as signing in does, and records the sign-in in `lastSignedInAt`.
 * Call it inside `db.update()`. Also drops sessions that have ended, so the table does not grow
 * forever.
 */
export function startSession(data: MockData, user: UserRecord, now: Date): SessionRecord {
  data.sessions = data.sessions.filter((s) => isSessionActive(s, now));
  const session: SessionRecord = {
    token: newSessionToken(),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
  };
  data.sessions.push(session);
  user.lastSignedInAt = session.createdAt;
  return session;
}

/** A new opaque session token. Random, unlike the seeded IDs, so it cannot be guessed. */
export function newSessionToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}

/** A new secret token for an invite or password reset link: 256 random bits, URL-safe. */
export function newLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The demo-only response header that carries the link the server would have emailed. */
export const DEMO_LINK_HEADER = 'X-Demo-Link';

/** The app page each link opens. */
const LINK_PAGES: Record<AccountLinkPurpose, string> = {
  invitation: '/set-password',
  password_reset: '/reset-password',
};

/**
 * The `X-Demo-Link` header for a link, on the origin the request came from, or no header at all
 * when demo links are off (`ctx.demoLinks`). The real backend emails the link instead and never
 * sends this header.
 */
export function demoLinkHeader(
  { url, demoLinks }: { url: URL; demoLinks: boolean },
  link: Pick<AccountLinkRecord, 'purpose' | 'token'>,
): Record<string, string> {
  if (!demoLinks) return {};
  const page = new URL(LINK_PAGES[link.purpose], url.origin);
  page.searchParams.set('token', link.token);
  return { [DEMO_LINK_HEADER]: page.toString() };
}

/**
 * Mock only: a SHA-256 hash of the password, salted with the user ID, so the browser's storage
 * never holds the password itself. The real backend must use a slow password hash such as
 * Argon2id, bcrypt or scrypt.
 */
export async function hashPassword(userId: string, password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether the password is the user's: the one they set through a link, or the demo password for
 * seeded users who never set one.
 */
export async function passwordMatches(
  data: MockData,
  user: UserRecord,
  password: string,
  demoPassword: string,
): Promise<boolean> {
  const credential = data.credentials.find((c) => c.userId === user.id);
  if (!credential) return password === demoPassword;
  return credential.passwordHash === (await hashPassword(user.id, password));
}
