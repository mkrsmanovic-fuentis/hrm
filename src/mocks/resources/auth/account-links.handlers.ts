import type { AccountLink } from '../../../app/core/api/api-schema.gen';
import type { AccountLinkRecord, UserRecord } from '../../db/mock-data';
import { canResetPassword, passwordProblem, sameEmail } from '../../rules/auth-rules';
import { isValidEmail, USER_EMAIL_MAX_LENGTH } from '../../rules/user-rules';
import { issueLink, requireLink, setPasswordThroughLink } from '../../support/account-links';
import { demoLinkHeader, hashPassword, startSession, toSession } from '../../support/auth';
import { BodyReader } from '../../support/body';
import { route } from '../../support/mock-route';

/**
 * Mock handlers for invite links and password resets, in the Authentication tag of the spec. All
 * public: the secret token in the link is the proof, so no session token is needed.
 *
 * - Links are checked before the body: unknown `404`, used or expired `410`.
 * - Setting a password signs the user in, like `POST /auth/session`.
 * - A password reset ends all the user's sessions before starting the new one.
 * - `POST /auth/password-resets` always answers `202`. Only when it created a link does the mock
 *   add the demo-only `X-Demo-Link` header.
 */
export const accountLinkRoutes = [
  route.get(
    '/auth/invitations/{invitationToken}',
    ({ db, now, params, ok }) => {
      const { link, user } = requireLink(db.data, params.invitationToken, 'invitation', now);
      return ok(toAccountLink(link, user));
    },
    { public: true },
  ),

  route.post(
    '/auth/invitations/{invitationToken}/password',
    async ({ db, now, params, ok, json, validationFailed }) => {
      const { link, user } = requireLink(db.data, params.invitationToken, 'invitation', now);
      const body = new BodyReader(await json(), ['password']);
      const password = body.password('password', (value) => passwordProblem(value, user.email));
      if (password === undefined || body.errors.length > 0) return validationFailed(body.errors);

      const passwordHash = await hashPassword(user.id, password);
      const session = db.update((data) => {
        setPasswordThroughLink(data, link, user, passwordHash, now);
        return startSession(data, user, now);
      });
      return ok(toSession(session, user, db.data, now), 201);
    },
    { public: true },
  ),

  route.post(
    '/auth/password-resets',
    async ({ db, now, url, json, accepted, validationFailed }) => {
      const body = new BodyReader(await json(), ['email']);
      const email = body.email('email', {
        required: true,
        maxLength: USER_EMAIL_MAX_LENGTH,
        isValid: isValidEmail,
      });
      if (email === undefined || body.errors.length > 0) return validationFailed(body.errors);

      // Unknown emails, deactivated users and users without a password get the same answer, and
      // no link, so the response does not reveal which emails have accounts.
      const user = db.data.users.find((u) => sameEmail(u.email, email));
      if (!user || !canResetPassword(user)) return accepted();

      const link = db.update((data) => issueLink(data, user, 'password_reset', now));
      return accepted(demoLinkHeader(url, link));
    },
    { public: true },
  ),

  route.get(
    '/auth/password-resets/{passwordResetToken}',
    ({ db, now, params, ok }) => {
      const { link, user } = requireLink(db.data, params.passwordResetToken, 'password_reset', now);
      return ok(toAccountLink(link, user));
    },
    { public: true },
  ),

  route.post(
    '/auth/password-resets/{passwordResetToken}/password',
    async ({ db, now, params, ok, json, validationFailed }) => {
      const { link, user } = requireLink(db.data, params.passwordResetToken, 'password_reset', now);
      const body = new BodyReader(await json(), ['password']);
      const password = body.password('password', (value) => passwordProblem(value, user.email));
      if (password === undefined || body.errors.length > 0) return validationFailed(body.errors);

      const passwordHash = await hashPassword(user.id, password);
      const session = db.update((data) => {
        setPasswordThroughLink(data, link, user, passwordHash, now);
        // A reset ends every session of the user, in case someone else was signed in as them.
        data.sessions = data.sessions.filter((s) => s.userId !== user.id);
        return startSession(data, user, now);
      });
      return ok(toSession(session, user, db.data, now), 201);
    },
    { public: true },
  ),
];

function toAccountLink(link: AccountLinkRecord, user: UserRecord): AccountLink {
  return { email: user.email, firstName: user.firstName, expiresAt: link.expiresAt };
}
