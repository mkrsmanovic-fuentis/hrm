import { ProblemType } from '../../../app/core/api/api-error';
import type { AccountLink, Session, User } from '../../../app/core/api/api-schema.gen';
import { PASSWORD_RESET_LIFETIME_MS, INVITATION_LIFETIME_MS } from '../../rules/training-rules';
import { DEMO_PASSWORD } from '../../seed/people.seed';
import type { SimulationFlags } from '../../support/simulation';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

const NEW_PASSWORD = 'correct horse battery';
const HOUR = 60 * 60 * 1000;

describe('invite link and password reset mock handlers', () => {
  /** Flags the tests change between requests, for example to move the clock. */
  let flags: SimulationFlags;

  function setup(options: TestMockApiOptions = {}) {
    flags = {};
    return createTestMockApi({ ...options, flags: () => flags });
  }

  type Mock = ReturnType<typeof setup>;

  function json(method: string, body: unknown, token?: string): RequestInit {
    return {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    };
  }

  function userByEmail(mock: Mock, email: string) {
    const user = mock.db.data.users.find((u) => u.email === email);
    if (!user) throw new Error(`No seeded user ${email}`);
    return user;
  }

  /** The token from an `X-Demo-Link` header. */
  function tokenOf(response: Response): string {
    const link = response.headers.get('X-Demo-Link');
    if (!link) throw new Error('No X-Demo-Link header');
    return new URL(link).searchParams.get('token') ?? '';
  }

  /** Creates a user as the administrator and returns the token of their invite link. */
  async function createUser(admin: Mock): Promise<{ user: User; token: string }> {
    const response = await admin.fetch(
      '/api/v1/users',
      json('POST', {
        email: 'hana.sato@brightwater.example',
        firstName: 'Hana',
        lastName: 'Sato',
        role: 'employee',
        departmentId: null,
      }),
    );
    expect(response.status).toBe(201);
    return { user: (await response.json()) as User, token: tokenOf(response) };
  }

  function resend(mock: Mock, userId: string) {
    return mock.fetch(`/api/v1/users/${userId}/invitation`, { method: 'POST' });
  }

  function setPassword(mock: Mock, token: string, password: unknown = NEW_PASSWORD) {
    return mock.fetch(
      `/api/v1/auth/invitations/${token}/password`,
      json('POST', { password }, 'none'),
    );
  }

  function requestReset(mock: Mock, email: unknown) {
    return mock.fetch('/api/v1/auth/password-resets', json('POST', { email }));
  }

  function resetPassword(mock: Mock, token: string, password: unknown = NEW_PASSWORD) {
    return mock.fetch(
      `/api/v1/auth/password-resets/${token}/password`,
      json('POST', { password }, 'none'),
    );
  }

  function signIn(mock: Mock, email: string, password: string) {
    return mock.fetch('/api/v1/auth/session', json('POST', { email, password }, 'none'));
  }

  async function expectProblem(response: Response, status: number, type: string) {
    expect(response.status).toBe(status);
    expect(((await response.json()) as { type: string }).type).toBe(type);
  }

  describe('invite links', () => {
    it('creates a 7-day link when a user is created, shown only in the demo header', async () => {
      const admin = setup();
      const { user, token } = await createUser(admin);

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(user.invitationStatus).toBe('pending');
      expect(user.invitationExpiresAt).toBe(
        new Date(TEST_NOW.getTime() + INVITATION_LIFETIME_MS).toISOString(),
      );
      const link = admin.db.data.accountLinks.find((l) => l.token === token);
      expect(link).toMatchObject({ userId: user.id, purpose: 'invitation', usedAt: null });

      const header = (
        await admin.fetch(
          '/api/v1/users',
          json('POST', {
            email: 'kai.berg@brightwater.example',
            firstName: 'Kai',
            lastName: 'Berg',
            role: 'employee',
          }),
        )
      ).headers.get('X-Demo-Link');
      expect(header).toMatch(/^http:\/\/localhost\/set-password\?token=[A-Za-z0-9_-]{43}$/);
    });

    it('checks a link without a session and says who it is for', async () => {
      const admin = setup();
      const { user, token } = await createUser(admin);

      const response = await admin.fetch(`/api/v1/auth/invitations/${token}`, {
        headers: { Authorization: 'Bearer none' },
      });

      expect(response.status).toBe(200);
      expect((await response.json()) as AccountLink).toEqual({
        email: user.email,
        firstName: 'Hana',
        expiresAt: user.invitationExpiresAt,
      });
    });

    it('sets the password, clears the invite, signs the user in and lets them sign in again', async () => {
      const admin = setup();
      const { user, token } = await createUser(admin);

      const response = await setPassword(admin, token);
      const session = (await response.json()) as Session;

      expect(response.status).toBe(201);
      expect(session.user).toMatchObject({
        id: user.id,
        passwordSetAt: TEST_NOW.toISOString(),
        invitationSentAt: null,
        invitationExpiresAt: null,
        invitationStatus: 'accepted',
        lastSignedInAt: TEST_NOW.toISOString(),
      });
      expect(admin.db.data.sessions.some((s) => s.token === session.token)).toBe(true);
      // The mock stores a hash, never the password.
      expect(JSON.stringify(admin.db.data)).not.toContain(NEW_PASSWORD);

      expect((await signIn(admin, user.email, NEW_PASSWORD)).status).toBe(201);
      expect((await signIn(admin, user.email, DEMO_PASSWORD)).status).toBe(401);
    });

    it('works only once', async () => {
      const admin = setup();
      const { token } = await createUser(admin);
      await setPassword(admin, token);

      await expectProblem(
        await admin.fetch(`/api/v1/auth/invitations/${token}`),
        410,
        ProblemType.linkUsed,
      );
      await expectProblem(
        await setPassword(admin, token, 'another long password'),
        410,
        ProblemType.linkUsed,
      );
    });

    it('expires after 7 days', async () => {
      const admin = setup();
      const { user, token } = await createUser(admin);

      flags = { clockOffsetMs: INVITATION_LIFETIME_MS - 1 };
      expect((await admin.fetch(`/api/v1/auth/invitations/${token}`)).status).toBe(200);

      flags = { clockOffsetMs: INVITATION_LIFETIME_MS };
      await expectProblem(
        await admin.fetch(`/api/v1/auth/invitations/${token}`),
        410,
        ProblemType.linkExpired,
      );
      await expectProblem(await setPassword(admin, token), 410, ProblemType.linkExpired);
      expect(userByEmail(admin, user.email).passwordSetAt).toBeNull();
    });

    it('answers 404 for an unknown token and for a deactivated user', async () => {
      const admin = setup();
      const { user, token } = await createUser(admin);

      await expectProblem(
        await admin.fetch('/api/v1/auth/invitations/not-a-token'),
        404,
        ProblemType.linkNotFound,
      );
      await admin.fetch(`/api/v1/users/${user.id}`, json('PATCH', { status: 'inactive' }));
      await expectProblem(await setPassword(admin, token), 404, ProblemType.linkNotFound);
    });

    it.each([
      ['missing', undefined, 'required'],
      ['shorter than 12 characters', 'elevenchars', 'too_short'],
      ['longer than 128 characters', 'x'.repeat(129), 'too_long'],
      ['the email address', 'Hana.Sato@brightwater.example', 'invalid_value'],
      ['not text', 123456789012, 'invalid_type'],
    ])('rejects a password that is %s with 422', async (_, password, code) => {
      const admin = setup();
      const { token } = await createUser(admin);

      const response = await admin.fetch(
        `/api/v1/auth/invitations/${token}/password`,
        json('POST', password === undefined ? {} : { password }, 'none'),
      );
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.errors).toEqual([expect.objectContaining({ field: 'password', code })]);
      // The link still works after a rejected password.
      expect((await admin.fetch(`/api/v1/auth/invitations/${token}`)).status).toBe(200);
    });

    it('counts characters as code points: an emoji is one character', async () => {
      const admin = setup();
      const { token } = await createUser(admin);

      // 11 letters and one emoji: 12 characters, 13 UTF-16 units.
      expect((await setPassword(admin, token, 'elevenchars🔑')).status).toBe(201);
    });

    it('rejects 11 characters, even when an emoji makes them 12 UTF-16 units', async () => {
      const admin = setup();
      const { token } = await createUser(admin);

      const response = await setPassword(admin, token, 'tenletters🔑');

      expect(response.status).toBe(422);
      expect((await response.json()).errors[0].code).toBe('too_short');
    });

    it('keeps spaces in a password: 12 characters with spaces around them are fine', async () => {
      const admin = setup();
      const { user, token } = await createUser(admin);

      expect((await setPassword(admin, token, '  ten chars ')).status).toBe(201);
      expect((await signIn(admin, user.email, '  ten chars ')).status).toBe(201);
      expect((await signIn(admin, user.email, 'ten chars')).status).toBe(401);
    });
  });

  describe('sending the invite again', () => {
    it('makes the old link stop working and starts a new 7 days', async () => {
      const admin = setup();
      const { user, token: oldToken } = await createUser(admin);
      // Two hours later: the administrator's session is still valid.
      flags = { clockOffsetMs: 2 * HOUR };

      const response = await resend(admin, user.id);
      const resent = (await response.json()) as User;
      const newToken = tokenOf(response);

      expect(response.status).toBe(201);
      expect(newToken).not.toBe(oldToken);
      const sentAt = new Date(TEST_NOW.getTime() + 2 * HOUR);
      expect(resent).toMatchObject({
        invitationSentAt: sentAt.toISOString(),
        invitationExpiresAt: new Date(sentAt.getTime() + INVITATION_LIFETIME_MS).toISOString(),
        invitationStatus: 'pending',
      });
      await expectProblem(await setPassword(admin, oldToken), 404, ProblemType.linkNotFound);
      expect((await setPassword(admin, newToken)).status).toBe(201);
    });

    it('revives an expired invite', async () => {
      const admin = setup();
      const expired = admin.db.data.users.find(
        (u) => u.passwordSetAt === null && Date.parse(u.invitationExpiresAt!) < TEST_NOW.getTime(),
      )!;

      const listed = (await (await admin.fetch(`/api/v1/users/${expired.id}`)).json()) as User;
      expect(listed.invitationStatus).toBe('expired');

      const response = await resend(admin, expired.id);
      expect(((await response.json()) as User).invitationStatus).toBe('pending');
    });

    it('is not logged in the audit log', async () => {
      const admin = setup();
      const pending = userByEmail(admin, 'aisha.khan@brightwater.example');
      const logSize = admin.db.data.auditLog.length;

      expect((await resend(admin, pending.id)).status).toBe(201);
      expect(admin.db.data.auditLog.length).toBe(logSize);
    });

    it('answers 409 for a user who has set a password, or is deactivated', async () => {
      const admin = setup();
      const withPassword = userByEmail(admin, 'amelia.hughes@brightwater.example');
      const { user } = await createUser(admin);
      await admin.fetch(`/api/v1/users/${user.id}`, json('PATCH', { status: 'inactive' }));

      await expectProblem(await resend(admin, withPassword.id), 409, ProblemType.conflict);
      await expectProblem(await resend(admin, user.id), 409, ProblemType.conflict);
    });

    it('answers 404 for an unknown user', async () => {
      const admin = setup();
      await expectProblem(
        await resend(admin, '00000000-0000-4000-8000-000000000000'),
        404,
        ProblemType.notFound,
      );
    });

    it('answers 403 to employees, and 401 without a session', async () => {
      const employee = setup({ signedInAs: 'employee' });
      const pending = userByEmail(employee, 'aisha.khan@brightwater.example');
      await expectProblem(await resend(employee, pending.id), 403, ProblemType.forbidden);
      expect(employee.db.data.accountLinks).toEqual([]);

      const anonymous = setup({ signedInAs: null });
      expect((await resend(anonymous, pending.id)).status).toBe(401);
    });
  });

  describe('password resets', () => {
    const EMAIL = 'amelia.hughes@brightwater.example';

    it('answers 202 and creates a 1-hour link for an active user with a password', async () => {
      const mock = setup({ signedInAs: null });

      const response = await requestReset(mock, '  Amelia.Hughes@Brightwater.Example ');

      expect(response.status).toBe(202);
      expect(await response.text()).toBe('');
      const token = tokenOf(response);
      expect(response.headers.get('X-Demo-Link')).toContain('/reset-password?token=');
      const link = mock.db.data.accountLinks.find((l) => l.token === token)!;
      expect(link.purpose).toBe('password_reset');
      expect(Date.parse(link.expiresAt) - Date.parse(link.createdAt)).toBe(
        PASSWORD_RESET_LIFETIME_MS,
      );
    });

    it.each([
      ['an unknown email', 'nobody@brightwater.example'],
      ['a deactivated user', 'sofia.lindqvist@brightwater.example'],
      ['a user whose invite is pending', 'aisha.khan@brightwater.example'],
    ])('answers the same 202 for %s, without a link', async (_, email) => {
      const mock = setup({ signedInAs: null });

      const response = await requestReset(mock, email);

      expect(response.status).toBe(202);
      expect(await response.text()).toBe('');
      expect(response.headers.has('X-Demo-Link')).toBe(false);
      expect(mock.db.data.accountLinks).toEqual([]);
    });

    it.each([
      ['missing', undefined, 'required'],
      ['not an email address', 'amelia', 'invalid_format'],
    ])('answers 422 for an email that is %s', async (_, email, code) => {
      const mock = setup({ signedInAs: null });

      const response = await requestReset(mock, email);

      expect(response.status).toBe(422);
      expect((await response.json()).errors).toEqual([
        expect.objectContaining({ field: 'email', code }),
      ]);
    });

    it('sets the new password, ends every session of the user and starts a new one', async () => {
      // The test session belongs to the employee who resets their password.
      const mock = setup({ signedInAs: 'employee' });
      const userId = mock.db.data.sessions.find((s) => s.token === mock.token)!.userId;
      const user = mock.db.data.users.find((u) => u.id === userId)!;
      expect(user.passwordSetAt).not.toBeNull();
      const otherSession = (await (
        await signIn(mock, user.email, DEMO_PASSWORD)
      ).json()) as Session;
      const token = tokenOf(await requestReset(mock, user.email));

      const response = await resetPassword(mock, token);
      const session = (await response.json()) as Session;

      expect(response.status).toBe(201);
      expect(session.user).toMatchObject({ id: user.id, passwordSetAt: TEST_NOW.toISOString() });
      expect(mock.db.data.sessions.filter((s) => s.userId === user.id)).toEqual([
        expect.objectContaining({ token: session.token }),
      ]);
      // The earlier sessions answer 401 now, including the test's own one.
      expect(
        (
          await mock.fetch('/api/v1/auth/session', {
            headers: { Authorization: `Bearer ${otherSession.token}` },
          })
        ).status,
      ).toBe(401);
      expect((await mock.fetch('/api/v1/auth/session')).status).toBe(401);

      expect((await signIn(mock, user.email, NEW_PASSWORD)).status).toBe(201);
      expect((await signIn(mock, user.email, DEMO_PASSWORD)).status).toBe(401);
    });

    it('works only once', async () => {
      const mock = setup({ signedInAs: null });
      const token = tokenOf(await requestReset(mock, EMAIL));
      await resetPassword(mock, token);

      await expectProblem(
        await mock.fetch(`/api/v1/auth/password-resets/${token}`),
        410,
        ProblemType.linkUsed,
      );
      await expectProblem(
        await resetPassword(mock, token, 'another long password'),
        410,
        ProblemType.linkUsed,
      );
    });

    it('expires after 1 hour', async () => {
      const mock = setup({ signedInAs: null });
      const token = tokenOf(await requestReset(mock, EMAIL));

      flags = { clockOffsetMs: HOUR - 1 };
      expect((await mock.fetch(`/api/v1/auth/password-resets/${token}`)).status).toBe(200);

      flags = { clockOffsetMs: HOUR };
      await expectProblem(
        await mock.fetch(`/api/v1/auth/password-resets/${token}`),
        410,
        ProblemType.linkExpired,
      );
      await expectProblem(await resetPassword(mock, token), 410, ProblemType.linkExpired);
    });

    it('replaces earlier links with a new request', async () => {
      const mock = setup({ signedInAs: null });
      const first = tokenOf(await requestReset(mock, EMAIL));
      const second = tokenOf(await requestReset(mock, EMAIL));

      await expectProblem(await resetPassword(mock, first), 404, ProblemType.linkNotFound);
      expect((await resetPassword(mock, second)).status).toBe(201);
    });

    it('does not work for a user deactivated after the request', async () => {
      const admin = setup();
      const user = userByEmail(admin, EMAIL);
      const token = tokenOf(await requestReset(admin, EMAIL));
      await admin.fetch(`/api/v1/users/${user.id}`, json('PATCH', { status: 'inactive' }));

      await expectProblem(await resetPassword(admin, token), 404, ProblemType.linkNotFound);
    });

    it('rejects a short password with 422 and keeps the link', async () => {
      const mock = setup({ signedInAs: null });
      const token = tokenOf(await requestReset(mock, EMAIL));

      const response = await resetPassword(mock, token, 'short');

      expect(response.status).toBe(422);
      expect((await mock.fetch(`/api/v1/auth/password-resets/${token}`)).status).toBe(200);
    });

    it('does not mix up invite and reset links', async () => {
      const mock = setup({ signedInAs: null });
      const token = tokenOf(await requestReset(mock, EMAIL));

      await expectProblem(
        await mock.fetch(`/api/v1/auth/invitations/${token}`),
        404,
        ProblemType.linkNotFound,
      );
    });

    it('stops a reset link working when an administrator changes the email', async () => {
      const admin = setup();
      const user = userByEmail(admin, EMAIL);
      const token = tokenOf(await requestReset(admin, EMAIL));

      await admin.fetch(
        `/api/v1/users/${user.id}`,
        json('PATCH', { email: 'amelia.h@brightwater.example' }),
      );

      await expectProblem(await resetPassword(admin, token), 404, ProblemType.linkNotFound);
    });

    it('keeps a reset link when an edit leaves the email as it is, apart from case', async () => {
      const admin = setup();
      const user = userByEmail(admin, EMAIL);
      const token = tokenOf(await requestReset(admin, EMAIL));

      await admin.fetch(`/api/v1/users/${user.id}`, json('PATCH', { lastName: 'Hughes-Lee' }));

      expect((await admin.fetch(`/api/v1/auth/password-resets/${token}`)).status).toBe(200);
    });
  });

  describe('deactivating', () => {
    it('makes invite and reset links stop working for good, even after reactivating', async () => {
      const admin = setup();
      const { user: hana, token: invite } = await createUser(admin);
      const amelia = userByEmail(admin, 'amelia.hughes@brightwater.example');
      const reset = tokenOf(await requestReset(admin, amelia.email));

      for (const id of [hana.id, amelia.id]) {
        await admin.fetch(`/api/v1/users/${id}`, json('PATCH', { status: 'inactive' }));
        await admin.fetch(`/api/v1/users/${id}`, json('PATCH', { status: 'active' }));
      }

      await expectProblem(await setPassword(admin, invite), 404, ProblemType.linkNotFound);
      await expectProblem(await resetPassword(admin, reset), 404, ProblemType.linkNotFound);
      expect(admin.db.data.accountLinks).toEqual([]);
      // Sending the invite again gives a working link.
      expect((await setPassword(admin, tokenOf(await resend(admin, hana.id)))).status).toBe(201);
    });
  });

  describe('demo links', () => {
    it('are sent only while demo links are on', async () => {
      const admin = setup({ demoLinks: false });
      const pending = userByEmail(admin, 'aisha.khan@brightwater.example');

      const created = await admin.fetch(
        '/api/v1/users',
        json('POST', {
          email: 'kai.berg@brightwater.example',
          firstName: 'Kai',
          lastName: 'Berg',
          role: 'employee',
        }),
      );
      const resent = await resend(admin, pending.id);
      const reset = await requestReset(admin, 'amelia.hughes@brightwater.example');

      expect([created.status, resent.status, reset.status]).toEqual([201, 201, 202]);
      for (const response of [created, resent, reset]) {
        expect(response.headers.has('X-Demo-Link')).toBe(false);
      }
      expect(await reset.text()).toBe('');
      // The links exist, as they would be emailed; only the response leaves them out.
      expect(admin.db.data.accountLinks.map((l) => l.purpose).sort()).toEqual([
        'invitation',
        'invitation',
        'password_reset',
      ]);
    });

    it('make an existing and an unknown email look the same when off', async () => {
      const mock = setup({ signedInAs: null, demoLinks: false });

      const known = await requestReset(mock, 'amelia.hughes@brightwater.example');
      const unknown = await requestReset(mock, 'nobody@brightwater.example');

      expect([known.status, unknown.status]).toEqual([202, 202]);
      expect([...known.headers.keys()].sort()).toEqual([...unknown.headers.keys()].sort());
      expect(await known.text()).toBe(await unknown.text());
    });
  });
});
