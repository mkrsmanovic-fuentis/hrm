import { environment } from '../../../environments/environment';
import { ProblemType } from '../../../app/core/api/api-error';
import type { Session } from '../../../app/core/api/api-schema.gen';
import { SESSION_LIFETIME_MS } from '../../rules/auth-rules';
import { DEMO_PASSWORD } from '../../seed/people.seed';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

describe('auth mock handlers', () => {
  function setup(options: TestMockApiOptions = {}) {
    return createTestMockApi({ signedInAs: null, ...options });
  }

  function signIn(mock: ReturnType<typeof setup>, body: unknown) {
    return mock.fetch('/api/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  function bearer(token: string): RequestInit {
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  describe('sign in', () => {
    it('starts an 8-hour session and returns the token and the user', async () => {
      const mock = setup();
      const admin = mock.db.data.users.find((u) => u.email === 'maja.novak@brightwater.example')!;

      const response = await signIn(mock, { email: admin.email, password: DEMO_PASSWORD });
      const session = (await response.json()) as Session;

      expect(response.status).toBe(201);
      expect(session.token).toMatch(/^[0-9a-f]{64}$/);
      expect(session.user).toMatchObject({ id: admin.id, role: 'administrator' });
      expect(session.createdAt).toBe(TEST_NOW.toISOString());
      expect(Date.parse(session.expiresAt) - Date.parse(session.createdAt)).toBe(
        SESSION_LIFETIME_MS,
      );
      expect(mock.db.data.sessions.map((s) => s.token)).toEqual([session.token]);
      expect(mock.db.data.users.find((u) => u.id === admin.id)?.lastSignedInAt).toBe(
        TEST_NOW.toISOString(),
      );
    });

    it('matches the email without regard to case and surrounding spaces', async () => {
      const mock = setup();

      const response = await signIn(mock, {
        email: '  Maja.Novak@Brightwater.Example ',
        password: DEMO_PASSWORD,
      });

      expect(response.status).toBe(201);
    });

    it('signs in both demo accounts offered on the login page', async () => {
      const mock = setup();
      const demo = environment.demo!;

      for (const account of demo.accounts) {
        const response = await signIn(mock, { email: account.email, password: demo.password });
        const session = (await response.json()) as Session;
        expect(response.status, account.email).toBe(201);
        expect(session.user.role).toBe(account.role);
      }
    });

    it.each([
      ['a wrong password', 'maja.novak@brightwater.example', 'wrong-password'],
      ['an unknown email', 'nobody@brightwater.example', DEMO_PASSWORD],
      ['a user whose invite is still pending', 'aisha.khan@brightwater.example', DEMO_PASSWORD],
    ])('answers 401 invalid credentials for %s', async (_, email, password) => {
      const mock = setup();

      const response = await signIn(mock, { email, password });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json');
      expect(body).toMatchObject({
        type: ProblemType.invalidCredentials,
        title: 'Wrong email or password',
        status: 401,
      });
      expect(mock.db.data.sessions).toEqual([]);
    });

    it('answers 403 account inactive for a deactivated user with the right password', async () => {
      const mock = setup();
      const inactive = mock.db.data.users.find((u) => u.status === 'inactive')!;

      const response = await signIn(mock, { email: inactive.email, password: DEMO_PASSWORD });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ type: ProblemType.accountInactive });
      expect(mock.db.data.sessions).toEqual([]);
    });

    it('answers a deactivated user with the wrong password like any wrong password', async () => {
      const mock = setup();
      const inactive = mock.db.data.users.find((u) => u.status === 'inactive')!;

      const response = await signIn(mock, { email: inactive.email, password: 'nope' });

      expect(response.status).toBe(401);
    });

    it('lists every missing or invalid field', async () => {
      const mock = setup();

      const missing = await signIn(mock, {});
      expect(missing.status).toBe(422);
      expect((await missing.json()).errors).toEqual([
        expect.objectContaining({ location: 'body', field: 'email', code: 'required' }),
        expect.objectContaining({ location: 'body', field: 'password', code: 'required' }),
      ]);

      const badEmail = await signIn(mock, { email: 'maja', password: 'x' });
      expect((await badEmail.json()).errors).toEqual([
        expect.objectContaining({ field: 'email', code: 'invalid_format' }),
      ]);
    });

    it('answers 400 when the body is not JSON', async () => {
      const mock = setup();

      const response = await signIn(mock, '{not json');

      expect(response.status).toBe(400);
    });
  });

  describe('session token', () => {
    async function signedIn(options: TestMockApiOptions = {}) {
      const mock = setup(options);
      const response = await signIn(mock, {
        email: 'maja.novak@brightwater.example',
        password: DEMO_PASSWORD,
      });
      const session = (await response.json()) as Session;
      return { mock, session };
    }

    it('returns the current session for a valid token', async () => {
      const { mock, session } = await signedIn();

      const response = await mock.fetch('/api/v1/auth/session', bearer(session.token));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(session);
    });

    it.each([
      ['no token', undefined, 'Sign in to continue.'],
      ['an unknown token', bearer('not-a-session'), 'The session is not valid. Sign in again.'],
    ])('answers 401 unauthenticated with %s, on every other endpoint', async (_, init, detail) => {
      const mock = setup();

      for (const path of ['/api/v1/auth/session', '/api/v1/organization', '/api/v1/topics']) {
        const response = await mock.fetch(path, init);
        expect(response.status, path).toBe(401);
        expect(await response.json()).toMatchObject({
          type: ProblemType.unauthenticated,
          detail,
        });
      }
    });

    it('answers 401 once the session has expired', async () => {
      const { mock, session } = await signedIn();
      mock.db.update((data) => {
        data.sessions[0].expiresAt = TEST_NOW.toISOString();
      });

      const response = await mock.fetch('/api/v1/topics', bearer(session.token));

      expect(response.status).toBe(401);
      expect((await response.json()).detail).toBe('The session has expired. Sign in again.');
    });

    it('ends the session on sign-out, after which the token gets 401', async () => {
      const { mock, session } = await signedIn();

      const signOut = await mock.fetch('/api/v1/auth/session', {
        method: 'DELETE',
        ...bearer(session.token),
      });
      const after = await mock.fetch('/api/v1/organization', bearer(session.token));

      expect(signOut.status).toBe(204);
      expect(mock.db.data.sessions).toEqual([]);
      expect(after.status).toBe(401);
    });

    it('answers sign-out with 204 even without a valid token', async () => {
      const mock = setup();

      const response = await mock.fetch('/api/v1/auth/session', { method: 'DELETE' });

      expect(response.status).toBe(204);
    });
  });
});
