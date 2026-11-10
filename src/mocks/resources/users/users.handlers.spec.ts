import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../app/core/api/api-client';
import { ApiError, ProblemType } from '../../../app/core/api/api-error';
import { SESSION_LIFETIME_MS } from '../../rules/auth-rules';
import { INVITATION_LIFETIME_MS, toAssignment } from '../../rules/training-rules';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

describe('users mock handlers', () => {
  function setup(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const session = mock.db.data.sessions.find((s) => s.token === mock.token);
    return { api: TestBed.inject(ApiClient), mock, signedInId: session?.userId ?? '' };
  }

  type Mock = ReturnType<typeof setup>['mock'];

  async function failure(promise: Promise<unknown>): Promise<ApiError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error('Expected the request to fail');
  }

  function userNamed(mock: Mock, firstName: string) {
    const user = mock.db.data.users.find((u) => u.firstName === firstName);
    if (!user) throw new Error(`No seeded user ${firstName}`);
    return user;
  }

  function departmentNamed(mock: Mock, name: string) {
    const department = mock.db.data.departments.find((d) => d.name === name);
    if (!department) throw new Error(`No seeded department ${name}`);
    return department;
  }

  const newUser = (departmentId: string | null = null) => ({
    email: '  Hana.Sato@Brightwater.example ',
    firstName: ' Hana ',
    lastName: 'Sato',
    role: 'employee' as const,
    departmentId,
  });

  describe('list', () => {
    it('lists every user, active and inactive, sorted by full name', async () => {
      const { api, mock } = setup();

      const result = await firstValueFrom(api.get('/users', { query: { pageSize: 100 } }));

      expect(result.page.totalItems).toBe(mock.db.data.users.length);
      const names = result.items.map((u) => `${u.firstName} ${u.lastName}`);
      expect(names).toEqual(
        [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      );
      expect(result.items.map((u) => u.status)).toContain('inactive');
      expect(result.items.map((u) => u.role)).toContain('administrator');
    });

    it('derives the training counts from the assignments: all of them, and the passed ones', async () => {
      const { api, mock } = setup();
      const { assignments, attempts } = mock.db.data;
      const withAssignments = mock.db.data.users.filter((u) =>
        assignments.some((a) => a.userId === u.id),
      );
      expect(withAssignments.length).toBeGreaterThan(0);

      const result = await firstValueFrom(api.get('/users', { query: { pageSize: 100 } }));

      for (const user of withAssignments) {
        const own = assignments
          .filter((a) => a.userId === user.id)
          .map((a) => toAssignment(a, attempts, TEST_NOW));
        expect(result.items.find((u) => u.id === user.id)).toMatchObject({
          assignedTrainingCount: own.length,
          completedTrainingCount: own.filter((a) => a.status === 'passed').length,
        });
      }
    });

    it('keeps counting the assignments of a deactivated user', async () => {
      const { api, mock } = setup();
      const sofia = userNamed(mock, 'Sofia');
      const own = mock.db.data.assignments.filter((a) => a.userId === sofia.id);
      expect(sofia.status).toBe('inactive');
      expect(own.length).toBeGreaterThan(0);

      const user = await firstValueFrom(api.get('/users/{userId}', { path: { userId: sofia.id } }));

      expect(user.assignedTrainingCount).toBe(own.length);
    });

    it('filters by status, role and department', async () => {
      const { api, mock } = setup();
      const finance = departmentNamed(mock, 'Finance');

      const inactive = await firstValueFrom(api.get('/users', { query: { status: 'inactive' } }));
      const admins = await firstValueFrom(api.get('/users', { query: { role: 'administrator' } }));
      const inFinance = await firstValueFrom(
        api.get('/users', { query: { departmentId: finance.id } }),
      );

      expect(inactive.items.map((u) => u.firstName).sort()).toEqual(['Ana', 'Lena', 'Sofia']);
      expect(admins.items.map((u) => u.firstName).sort()).toEqual(['Daniel', 'Maja']);
      expect(inFinance.items.every((u) => u.departmentId === finance.id)).toBe(true);
      expect(inFinance.items.length).toBe(
        mock.db.data.users.filter((u) => u.departmentId === finance.id).length,
      );
    });

    it('searches the full name and the email, ignoring case and spaces around it', async () => {
      const { api } = setup();

      const byName = await firstValueFrom(api.get('/users', { query: { q: '  oliver GRANT ' } }));
      const byEmail = await firstValueFrom(api.get('/users', { query: { q: 'chloe.martin@' } }));

      expect(byName.items.map((u) => u.email)).toEqual(['oliver.grant@brightwater.example']);
      expect(byEmail.items.map((u) => u.firstName)).toEqual(['Chloé']);
    });

    it('treats a plain and a typographic apostrophe in the search the same', async () => {
      const { api } = setup();

      for (const q of ["o'neill", 'O’Neill', 'o‘neill']) {
        const result = await firstValueFrom(api.get('/users', { query: { q } }));
        expect(result.items.map((u) => u.lastName)).toEqual(['O’Neill']);
      }
    });

    it('sorts by completed training count', async () => {
      const { api } = setup();

      const result = await firstValueFrom(
        api.get('/users', { query: { sort: '-completedTrainingCount', pageSize: 100 } }),
      );

      const counts = result.items.map((u) => u.completedTrainingCount);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    it('answers invalid query parameters with a validation problem', async () => {
      const { mock } = setup();

      const response = await mock.fetch(
        `/api/v1/users?status=archived&role=owner&sort=age&q=${'x'.repeat(255)}`,
      );
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.errors.map((e: { field: string }) => e.field)).toEqual([
        'status',
        'role',
        'q',
        'sort',
      ]);
    });
  });

  describe('get one', () => {
    it('returns a user with counts, and 404 for an unknown ID', async () => {
      const { api, mock } = setup();
      const oliver = userNamed(mock, 'Oliver');

      await expect(
        firstValueFrom(api.get('/users/{userId}', { path: { userId: oliver.id } })),
      ).resolves.toMatchObject({
        id: oliver.id,
        email: 'oliver.grant@brightwater.example',
        assignedTrainingCount: expect.any(Number),
        completedTrainingCount: expect.any(Number),
      });

      const error = await failure(
        firstValueFrom(api.get('/users/{userId}', { path: { userId: 'nope' } })),
      );
      expect(error.isNotFound).toBe(true);
    });
  });

  describe('create', () => {
    it('creates an active user with an invite, trims the fields, and logs it', async () => {
      const { api, mock, signedInId } = setup();
      const finance = departmentNamed(mock, 'Finance');
      const logSize = mock.db.data.auditLog.length;
      const at = TEST_NOW.toISOString();
      const expiresAt = new Date(TEST_NOW.getTime() + INVITATION_LIFETIME_MS).toISOString();

      const created = await firstValueFrom(api.post('/users', { body: newUser(finance.id) }));

      expect(created).toMatchObject({
        email: 'Hana.Sato@Brightwater.example',
        firstName: 'Hana',
        lastName: 'Sato',
        role: 'employee',
        departmentId: finance.id,
        status: 'active',
        invitationSentAt: at,
        invitationExpiresAt: expiresAt,
        passwordSetAt: null,
        lastSignedInAt: null,
        assignedTrainingCount: 0,
        completedTrainingCount: 0,
        organizationId: mock.db.data.organization.id,
        createdAt: at,
        updatedAt: at,
      });
      expect(mock.db.data.auditLog.slice(logSize)).toEqual([
        expect.objectContaining({
          action: 'created',
          entityType: 'user',
          entityId: created.id,
          actorId: signedInId,
          changes: expect.arrayContaining([
            { field: 'email', oldValue: null, newValue: 'Hana.Sato@Brightwater.example' },
            { field: 'role', oldValue: null, newValue: 'employee' },
            { field: 'departmentId', oldValue: null, newValue: finance.id },
            { field: 'invitationExpiresAt', oldValue: null, newValue: expiresAt },
          ]),
        }),
      ]);
      const fields = mock.db.data.auditLog[logSize].changes.map((change) => change.field);
      expect(fields).not.toContain('assignedTrainingCount');
      expect(fields).not.toContain('passwordSetAt');
    });

    it('creates an administrator with no department, and answers 201', async () => {
      const { mock } = setup();

      const response = await mock.fetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'hana.sato@brightwater.example',
          firstName: 'Hana',
          lastName: 'Sato',
          role: 'administrator',
        }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ role: 'administrator', departmentId: null });
    });

    it('answers 409 for an email already in use, ignoring case and spaces, also by an inactive user', async () => {
      const { api, mock } = setup();
      const users = mock.db.data.users.length;
      const logSize = mock.db.data.auditLog.length;

      for (const email of [
        ' OLIVER.grant@brightwater.example ',
        'sofia.lindqvist@brightwater.example',
      ]) {
        const error = await failure(
          firstValueFrom(api.post('/users', { body: { ...newUser(), email } })),
        );
        expect(error.status).toBe(409);
        expect(error.problem.type).toBe(ProblemType.conflict);
        expect(error.fieldErrors).toEqual([
          expect.objectContaining({ location: 'body', field: 'email', code: 'not_unique' }),
        ]);
      }
      expect(mock.db.data.users).toHaveLength(users);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 422 with every invalid field, and logs nothing', async () => {
      const { mock } = setup();
      const logSize = mock.db.data.auditLog.length;

      const response = await mock.fetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          firstName: ' ',
          lastName: 'x'.repeat(101),
          role: 'owner',
          status: 'inactive',
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.type).toBe(ProblemType.validationFailed);
      expect(body.errors).toEqual([
        expect.objectContaining({ field: 'status', code: 'invalid_value' }),
        expect.objectContaining({ field: 'email', code: 'invalid_format' }),
        expect.objectContaining({ field: 'firstName', code: 'required' }),
        expect.objectContaining({ field: 'lastName', code: 'too_long' }),
        expect.objectContaining({ field: 'role', code: 'invalid_value' }),
      ]);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 422 for missing required fields', async () => {
      const { mock } = setup();

      const response = await mock.fetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await response.json();

      expect(body.errors).toEqual(
        ['email', 'firstName', 'lastName', 'role'].map((field) =>
          expect.objectContaining({ field, code: 'required' }),
        ),
      );
    });

    it('answers 422 for an inactive or unknown department', async () => {
      const { api, mock } = setup();
      const facilities = departmentNamed(mock, 'Facilities');

      for (const departmentId of [facilities.id, 'nope']) {
        const error = await failure(
          firstValueFrom(api.post('/users', { body: newUser(departmentId) })),
        );
        expect(error.isValidation).toBe(true);
        expect(error.fieldErrors).toEqual([
          expect.objectContaining({ field: 'departmentId', code: 'invalid_value' }),
        ]);
      }
    });
  });

  describe('update', () => {
    it('edits a user and logs only the changed fields', async () => {
      const { api, mock } = setup();
      const oliver = userNamed(mock, 'Oliver');
      const sales = departmentNamed(mock, 'Sales');
      const logSize = mock.db.data.auditLog.length;

      const updated = await firstValueFrom(
        api.patch('/users/{userId}', {
          path: { userId: oliver.id },
          body: { lastName: 'Grant-Hill', departmentId: sales.id, firstName: 'Oliver' },
        }),
      );

      expect(updated).toMatchObject({
        lastName: 'Grant-Hill',
        departmentId: sales.id,
        updatedAt: TEST_NOW.toISOString(),
      });
      expect(mock.db.data.auditLog.slice(logSize)).toEqual([
        expect.objectContaining({
          action: 'updated',
          entityType: 'user',
          entityId: oliver.id,
          changes: [
            { field: 'lastName', oldValue: 'Grant', newValue: 'Grant-Hill' },
            { field: 'departmentId', oldValue: expect.any(String), newValue: sales.id },
          ],
        }),
      ]);
    });

    it('changes the role of another user, and removes the department', async () => {
      const { api, mock } = setup();
      const oliver = userNamed(mock, 'Oliver');

      const updated = await firstValueFrom(
        api.patch('/users/{userId}', {
          path: { userId: oliver.id },
          body: { role: 'administrator', departmentId: null },
        }),
      );

      expect(updated).toMatchObject({ role: 'administrator', departmentId: null });
    });

    it('keeps its own email when only the case changes, and 409 for another user’s email', async () => {
      const { api, mock } = setup();
      const oliver = userNamed(mock, 'Oliver');
      const path = { userId: oliver.id };

      const updated = await firstValueFrom(
        api.patch('/users/{userId}', { path, body: { email: 'Oliver.Grant@brightwater.example' } }),
      );
      const error = await failure(
        firstValueFrom(
          api.patch('/users/{userId}', {
            path,
            body: { email: 'chloe.martin@brightwater.example' },
          }),
        ),
      );

      expect(updated.email).toBe('Oliver.Grant@brightwater.example');
      expect(error.status).toBe(409);
      expect(error.fieldErrors[0]).toMatchObject({ field: 'email', code: 'not_unique' });
    });

    it('lets a user keep an inactive department, but not move into one', async () => {
      const { api, mock } = setup();
      const patrick = userNamed(mock, 'Patrick');
      const oliver = userNamed(mock, 'Oliver');
      const facilities = departmentNamed(mock, 'Facilities');
      expect(patrick.departmentId).toBe(facilities.id);

      const kept = await firstValueFrom(
        api.patch('/users/{userId}', {
          path: { userId: patrick.id },
          body: { firstName: 'Pat', departmentId: facilities.id },
        }),
      );
      const error = await failure(
        firstValueFrom(
          api.patch('/users/{userId}', {
            path: { userId: oliver.id },
            body: { departmentId: facilities.id },
          }),
        ),
      );

      expect(kept).toMatchObject({ firstName: 'Pat', departmentId: facilities.id });
      expect(error.fieldErrors).toEqual([
        expect.objectContaining({ field: 'departmentId', message: 'Choose an active department.' }),
      ]);
      expect(oliver.departmentId).not.toBe(facilities.id);
    });

    it('logs nothing and keeps updatedAt when nothing changes', async () => {
      const { api, mock } = setup();
      const oliver = userNamed(mock, 'Oliver');
      const { updatedAt } = oliver;
      const logSize = mock.db.data.auditLog.length;

      const updated = await firstValueFrom(
        api.patch('/users/{userId}', {
          path: { userId: oliver.id },
          body: { firstName: 'Oliver', status: 'active', role: 'employee' },
        }),
      );

      expect(updated.updatedAt).toBe(updatedAt);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 422 for invalid and unknown fields, and changes nothing', async () => {
      const { mock } = setup();
      const oliver = userNamed(mock, 'Oliver');
      const logSize = mock.db.data.auditLog.length;

      const response = await mock.fetch(`/api/v1/users/${oliver.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '', status: 'archived', assignedTrainingCount: 3 }),
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.errors.map((e: { field: string }) => e.field)).toEqual([
        'assignedTrainingCount',
        'email',
        'status',
      ]);
      expect(oliver.email).toBe('oliver.grant@brightwater.example');
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 404 for an unknown user', async () => {
      const { api } = setup();

      const error = await failure(
        firstValueFrom(
          api.patch('/users/{userId}', { path: { userId: 'nope' }, body: { firstName: 'X' } }),
        ),
      );

      expect(error.isNotFound).toBe(true);
    });
  });

  describe('deactivate and reactivate', () => {
    it('logs deactivated and reactivated, and leaves the assignments unchanged', async () => {
      const { api, mock } = setup();
      const oliver = userNamed(mock, 'Oliver');
      const assignments = structuredClone(
        mock.db.data.assignments.filter((a) => a.userId === oliver.id),
      );
      const logSize = mock.db.data.auditLog.length;
      const path = { userId: oliver.id };

      const before = await firstValueFrom(api.get('/users/{userId}', { path }));
      const deactivated = await firstValueFrom(
        api.patch('/users/{userId}', { path, body: { status: 'inactive' } }),
      );
      const reactivated = await firstValueFrom(
        api.patch('/users/{userId}', { path, body: { status: 'active' } }),
      );

      expect(deactivated.status).toBe('inactive');
      expect(reactivated.status).toBe('active');
      expect(mock.db.data.assignments.filter((a) => a.userId === oliver.id)).toEqual(assignments);
      expect(deactivated.assignedTrainingCount).toBe(before.assignedTrainingCount);
      expect(deactivated.completedTrainingCount).toBe(before.completedTrainingCount);
      expect(
        mock.db.data.auditLog.slice(logSize).map((entry) => [entry.action, entry.changes]),
      ).toEqual([
        ['deactivated', []],
        ['reactivated', []],
      ]);
    });

    it('logs an edit with a status change as updated, then deactivated', async () => {
      const { api, mock } = setup();
      const oliver = userNamed(mock, 'Oliver');
      const logSize = mock.db.data.auditLog.length;

      await firstValueFrom(
        api.patch('/users/{userId}', {
          path: { userId: oliver.id },
          body: { lastName: 'Grant-Hill', status: 'inactive' },
        }),
      );

      const entries = mock.db.data.auditLog.slice(logSize);
      expect(entries.map((entry) => entry.action)).toEqual(['updated', 'deactivated']);
      expect(entries[0].changes).toEqual([
        { field: 'lastName', oldValue: 'Grant', newValue: 'Grant-Hill' },
      ]);
    });

    it('ends the user’s sessions at once: their next request gets 401', async () => {
      const { api, mock } = setup();
      const oliver = userNamed(mock, 'Oliver');
      const token = 'oliver-session';
      mock.db.update((data) =>
        data.sessions.push({
          token,
          userId: oliver.id,
          createdAt: TEST_NOW.toISOString(),
          expiresAt: new Date(TEST_NOW.getTime() + SESSION_LIFETIME_MS).toISOString(),
        }),
      );
      const asOliver = () =>
        mock.fetch('/api/v1/auth/session', { headers: { Authorization: `Bearer ${token}` } });
      expect((await asOliver()).status).toBe(200);

      await firstValueFrom(
        api.patch('/users/{userId}', { path: { userId: oliver.id }, body: { status: 'inactive' } }),
      );
      const response = await asOliver();

      expect(response.status).toBe(401);
      expect((await response.json()).type).toBe(ProblemType.unauthenticated);
      expect(mock.db.data.sessions.some((s) => s.userId === oliver.id)).toBe(false);

      // Reactivating lets them sign in again, but does not bring the old session back.
      await firstValueFrom(
        api.patch('/users/{userId}', { path: { userId: oliver.id }, body: { status: 'active' } }),
      );
      expect((await asOliver()).status).toBe(401);
    });

    it('rejects a session of an inactive user, even one still stored', async () => {
      const { mock } = setup({ signedInAs: 'employee' });
      expect((await mock.fetch('/api/v1/auth/session')).status).toBe(200);

      mock.db.update((data) => {
        const session = data.sessions.find((s) => s.token === mock.token);
        const user = data.users.find((u) => u.id === session?.userId);
        if (user) user.status = 'inactive';
      });

      expect((await mock.fetch('/api/v1/auth/session')).status).toBe(401);
      expect((await mock.fetch('/api/v1/organization')).status).toBe(401);
    });
  });

  describe('own account', () => {
    it('answers 409 when administrators deactivate themselves or change their own role', async () => {
      const { api, mock, signedInId } = setup();
      const me = mock.db.data.users.find((u) => u.id === signedInId);
      const logSize = mock.db.data.auditLog.length;
      const path = { userId: signedInId };

      const deactivate = await failure(
        firstValueFrom(api.patch('/users/{userId}', { path, body: { status: 'inactive' } })),
      );
      const changeRole = await failure(
        firstValueFrom(api.patch('/users/{userId}', { path, body: { role: 'employee' } })),
      );

      expect(deactivate.status).toBe(409);
      expect(deactivate.problem.detail).toBe('You cannot deactivate your own account.');
      expect(changeRole.status).toBe(409);
      expect(changeRole.problem.detail).toBe('You cannot change your own role.');
      expect(me).toMatchObject({ status: 'active', role: 'administrator' });
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('lets administrators edit their own name, and send their own role unchanged', async () => {
      const { api, signedInId } = setup();

      const updated = await firstValueFrom(
        api.patch('/users/{userId}', {
          path: { userId: signedInId },
          body: { firstName: 'Maja-Lena', role: 'administrator', status: 'active' },
        }),
      );

      expect(updated).toMatchObject({ firstName: 'Maja-Lena', role: 'administrator' });
    });

    it('lets administrators deactivate another administrator', async () => {
      const { api, mock } = setup();
      const daniel = userNamed(mock, 'Daniel');

      const updated = await firstValueFrom(
        api.patch('/users/{userId}', { path: { userId: daniel.id }, body: { status: 'inactive' } }),
      );

      expect(updated.status).toBe('inactive');
    });
  });

  describe('as an employee', () => {
    it('answers 403 on every endpoint and changes nothing', async () => {
      const { mock } = setup({ signedInAs: 'employee' });
      const oliver = userNamed(mock, 'Oliver');
      const logSize = mock.db.data.auditLog.length;
      const json = { 'Content-Type': 'application/json' };

      const responses = await Promise.all([
        mock.fetch('/api/v1/users'),
        mock.fetch(`/api/v1/users/${oliver.id}`),
        // Invalid bodies still get 403: the role is checked before validation.
        mock.fetch('/api/v1/users', { method: 'POST', headers: json, body: '{}' }),
        mock.fetch(`/api/v1/users/${oliver.id}`, {
          method: 'PATCH',
          headers: json,
          body: JSON.stringify({ status: 'inactive' }),
        }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((await response.json()).type).toBe(ProblemType.forbidden);
      }
      expect(oliver.status).toBe('active');
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });
  });
});
