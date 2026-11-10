import { ProblemType } from '../../app/core/api/api-error';
import type { User } from '../../app/core/api/api-schema.gen';
import { createTestMockApi, type TestMockApiOptions } from '../testing';
import { ownRecords, requireOwnRecord, requireRole } from './access';
import { route } from './mock-route';

/**
 * The helpers are tested through test routes on existing spec paths, so the answers go through
 * the same route wrapper as every real handler.
 */
describe('mock access helpers', () => {
  /** A route only administrators may call. */
  const adminOnly = route.get('/organization', (ctx) => {
    requireRole(ctx, 'administrator');
    return ctx.ok(ctx.db.data.organization);
  });

  /** A route that answers with one user, by ID, under the own-data rule. */
  const ownUser = route.get('/topics/{topicId}', (ctx) => {
    requireOwnRecord(
      ctx,
      ctx.db.data.users.find((user) => user.id === ctx.params.topicId),
      (user) => user.id,
      `User ${ctx.params.topicId} was not found.`,
    );
    return ctx.noContent();
  });

  function setup(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi({ routes: [adminOnly, ownUser], ...options });
    const session = mock.db.data.sessions.find((s) => s.token === mock.token);
    const me = mock.db.data.users.find((u) => u.id === session?.userId);
    const someoneElse = mock.db.data.users.find((u) => u.role === 'employee' && u.id !== me?.id);
    if (!someoneElse) throw new Error('The seed needs a second employee.');
    return { mock, me, someoneElse };
  }

  describe('requireRole', () => {
    it('lets a user with the role through', async () => {
      const { mock } = setup({ signedInAs: 'administrator' });

      const response = await mock.fetch('/api/v1/organization');

      expect(response.status).toBe(200);
    });

    it('answers 403 forbidden to any other role', async () => {
      const { mock } = setup({ signedInAs: 'employee' });

      const response = await mock.fetch('/api/v1/organization');

      expect(response.status).toBe(403);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json');
      expect(await response.json()).toEqual({
        type: ProblemType.forbidden,
        title: 'Access denied',
        status: 403,
        detail: 'You do not have permission to do this.',
        instance: '/api/v1/organization',
      });
    });

    it('still answers 401 without a session, before checking the role', async () => {
      const { mock } = setup({ signedInAs: null });

      const response = await mock.fetch('/api/v1/organization');

      expect(response.status).toBe(401);
    });

    it('returns the signed-in user, for the audit log actor', () => {
      const admin = { id: 'admin-1', role: 'administrator' } as User;

      expect(requireRole({ currentUser: admin }, 'administrator')).toBe(admin);
      expect(requireRole({ currentUser: admin }, 'employee', 'administrator')).toBe(admin);
    });
  });

  describe('own data only', () => {
    it('lets employees read their own record', async () => {
      const { mock, me } = setup({ signedInAs: 'employee' });

      const response = await mock.fetch(`/api/v1/topics/${me?.id}`);

      expect(response.status).toBe(204);
    });

    it("answers 404 to employees for another employee's record, as for a missing one", async () => {
      const { mock, someoneElse } = setup({ signedInAs: 'employee' });

      const other = await mock.fetch(`/api/v1/topics/${someoneElse.id}`);
      const missing = await mock.fetch('/api/v1/topics/does-not-exist');

      expect(other.status).toBe(404);
      expect(await other.json()).toMatchObject({
        type: ProblemType.notFound,
        detail: `User ${someoneElse.id} was not found.`,
      });
      expect(missing.status).toBe(404);
    });

    it("lets administrators read every user's records", async () => {
      const { mock, someoneElse } = setup({ signedInAs: 'administrator' });

      const response = await mock.fetch(`/api/v1/topics/${someoneElse.id}`);

      expect(response.status).toBe(204);
    });

    it('filters lists to the employee’s own records, and keeps all of them for administrators', () => {
      const records = [
        { id: 'a', userId: 'employee-1' },
        { id: 'b', userId: 'employee-2' },
        { id: 'c', userId: 'employee-1' },
      ];
      const employee = { currentUser: { id: 'employee-1', role: 'employee' } as User };
      const admin = { currentUser: { id: 'admin-1', role: 'administrator' } as User };

      expect(ownRecords(employee, records, (r) => r.userId).map((r) => r.id)).toEqual(['a', 'c']);
      expect(ownRecords(admin, records, (r) => r.userId)).toEqual(records);
    });
  });
});
