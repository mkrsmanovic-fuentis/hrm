import type { Session } from '../../app/core/api/api-schema.gen';
import type { MockData, SessionRecord, UserRecord } from '../db/mock-data';
import { isSessionActive } from '../rules/auth-rules';
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

/** A new opaque session token. Random, unlike the seeded IDs, so it cannot be guessed. */
export function newSessionToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
}
