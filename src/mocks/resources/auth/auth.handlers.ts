import type { FieldError } from '../../../app/core/api/api-schema.gen';
import { ProblemType } from '../../../app/core/api/api-error';
import {
  hasPassword,
  isSessionActive,
  sameEmail,
  SESSION_LIFETIME_MS,
} from '../../rules/auth-rules';
import { DEMO_PASSWORD } from '../../seed/people.seed';
import { newSessionToken, readBearerToken, toSession } from '../../support/auth';
import { problemResponse } from '../../support/problem';
import { route } from '../../support/mock-route';

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_LENGTH = 200;

/** Mock handlers for the Authentication tag in the spec. */
export const authRoutes = [
  route.post(
    '/auth/session',
    async ({ db, now, ok, url, json, validationFailed }) => {
      const body = await json<Record<string, unknown> | null>();
      const errors = [
        ...requiredString(body, 'email', EMAIL_MAX_LENGTH),
        ...requiredString(body, 'password', PASSWORD_MAX_LENGTH),
      ];
      const email = body?.['email'];
      if (errors.length === 0 && typeof email === 'string' && !email.includes('@')) {
        errors.push({
          location: 'body',
          field: 'email',
          code: 'invalid_format',
          message: 'Enter an email address.',
        });
      }
      if (errors.length > 0) return validationFailed(errors);

      const password = body?.['password'] as string;
      const user = db.data.users.find((u) => sameEmail(u.email, email as string));

      // Unknown email, no password set yet, wrong password: one answer, so the response does
      // not reveal which emails have accounts.
      if (!user || !hasPassword(user) || password !== DEMO_PASSWORD) {
        return problemResponse(401, 'The email or password is wrong.', {
          instance: url.pathname,
          kind: { type: ProblemType.invalidCredentials, title: 'Wrong email or password' },
        });
      }
      if (user.status === 'inactive') {
        return problemResponse(
          403,
          'This account is deactivated. Ask an administrator to reactivate it.',
          {
            instance: url.pathname,
            kind: { type: ProblemType.accountInactive, title: 'Account deactivated' },
          },
        );
      }

      const session = db.update((data) => {
        // Drop sessions that have ended, so the table does not grow forever.
        data.sessions = data.sessions.filter((s) => isSessionActive(s, now));
        const created = {
          token: newSessionToken(),
          userId: user.id,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
        };
        data.sessions.push(created);
        user.lastSignedInAt = created.createdAt;
        return created;
      });
      return ok(toSession(session, user, db.data, now), 201);
    },
    { public: true },
  ),

  route.get('/auth/session', ({ db, now, request, ok, currentUser, problem }) => {
    const token = readBearerToken(request);
    const session = db.data.sessions.find((s) => s.token === token);
    // The route wrapper has already checked the token, so both are set.
    if (!session || !currentUser) return problem(401);
    return ok(toSession(session, currentUser, db.data, now));
  }),

  route.delete(
    '/auth/session',
    ({ db, request, noContent }) => {
      const token = readBearerToken(request);
      if (token && db.data.sessions.some((s) => s.token === token)) {
        db.update((data) => {
          data.sessions = data.sessions.filter((s) => s.token !== token);
        });
      }
      return noContent();
    },
    { public: true },
  ),
];

function requiredString(
  body: Record<string, unknown> | null,
  field: string,
  maxLength: number,
): FieldError[] {
  const value = typeof body === 'object' && body !== null ? body[field] : undefined;
  if (value === undefined || value === null || value === '') {
    return [{ location: 'body', field, code: 'required', message: 'Required.' }];
  }
  if (typeof value !== 'string') {
    return [{ location: 'body', field, code: 'invalid_type', message: 'Must be text.' }];
  }
  if (value.length > maxLength) {
    return [
      {
        location: 'body',
        field,
        code: 'too_long',
        message: `Must be at most ${maxLength} characters.`,
      },
    ];
  }
  return [];
}
