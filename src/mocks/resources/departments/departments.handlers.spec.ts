import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../app/core/api/api-client';
import { ApiError, ProblemType } from '../../../app/core/api/api-error';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

describe('departments mock handlers', () => {
  function setup(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const admin = mock.db.data.users.find(
      (user) => user.role === 'administrator' && user.status === 'active',
    );
    return { api: TestBed.inject(ApiClient), mock, adminId: admin?.id };
  }

  async function failure(promise: Promise<unknown>): Promise<ApiError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error('Expected the request to fail');
  }

  function departmentNamed(mock: ReturnType<typeof setup>['mock'], name: string) {
    const department = mock.db.data.departments.find((d) => d.name === name);
    if (!department) throw new Error(`No seeded department ${name}`);
    return department;
  }

  describe('list', () => {
    it('lists every department, active and inactive, sorted by name with employee counts', async () => {
      const { api, mock } = setup();

      const result = await firstValueFrom(api.get('/departments', { query: { pageSize: 100 } }));

      expect(result.page.totalItems).toBe(9);
      expect(result.items.map((d) => d.name)).toEqual(
        [...result.items.map((d) => d.name)].sort((a, b) => a.localeCompare(b)),
      );
      expect(result.items.map((d) => d.status)).toContain('inactive');
      const engineering = result.items.find((d) => d.name === 'Engineering');
      const activeInEngineering = mock.db.data.users.filter(
        (u) => u.departmentId === engineering?.id && u.status === 'active',
      ).length;
      expect(engineering?.employeeCount).toBe(activeInEngineering);
      expect(activeInEngineering).toBeGreaterThan(0);
    });

    it('counts only active users', async () => {
      const { api, mock } = setup();
      const finance = departmentNamed(mock, 'Finance');
      const before = await firstValueFrom(
        api.get('/departments/{departmentId}', { path: { departmentId: finance.id } }),
      );
      mock.db.update((data) => {
        const member = data.users.find(
          (u) => u.departmentId === finance.id && u.status === 'active',
        );
        if (member) member.status = 'inactive';
      });

      const after = await firstValueFrom(
        api.get('/departments/{departmentId}', { path: { departmentId: finance.id } }),
      );

      expect(after.employeeCount).toBe(before.employeeCount - 1);
    });

    it('filters by status and searches names, ignoring case', async () => {
      const { api } = setup();

      const inactive = await firstValueFrom(
        api.get('/departments', { query: { status: 'inactive' } }),
      );
      const search = await firstValueFrom(api.get('/departments', { query: { q: '  ENG ' } }));

      expect(inactive.items.map((d) => d.name)).toEqual(['Facilities']);
      expect(search.items.map((d) => d.name)).toEqual(['Engineering']);
    });

    it('sorts by employee count', async () => {
      const { api } = setup();

      const result = await firstValueFrom(
        api.get('/departments', { query: { sort: '-employeeCount' } }),
      );

      const counts = result.items.map((d) => d.employeeCount);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    it('answers invalid query parameters with a validation problem', async () => {
      const { mock } = setup();

      const response = await mock.fetch(
        `/api/v1/departments?status=archived&sort=size&q=${'x'.repeat(101)}`,
      );
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.errors.map((e: { field: string }) => e.field)).toEqual(['status', 'q', 'sort']);
    });
  });

  describe('get one', () => {
    it('returns a department, and 404 for an unknown ID', async () => {
      const { api, mock } = setup();
      const sales = departmentNamed(mock, 'Sales');

      await expect(
        firstValueFrom(
          api.get('/departments/{departmentId}', { path: { departmentId: sales.id } }),
        ),
      ).resolves.toMatchObject({ id: sales.id, name: 'Sales', employeeCount: expect.any(Number) });

      const error = await failure(
        firstValueFrom(api.get('/departments/{departmentId}', { path: { departmentId: 'nope' } })),
      );
      expect(error.isNotFound).toBe(true);
    });
  });

  describe('create', () => {
    it('creates an active department, trims the fields, and logs it', async () => {
      const { api, mock, adminId } = setup();
      const logSize = mock.db.data.auditLog.length;

      const created = await firstValueFrom(
        api.post('/departments', { body: { name: '  Legal  ', description: '   ' } }),
      );

      expect(created).toMatchObject({
        name: 'Legal',
        description: null,
        status: 'active',
        employeeCount: 0,
        organizationId: mock.db.data.organization.id,
        createdAt: TEST_NOW.toISOString(),
        updatedAt: TEST_NOW.toISOString(),
      });
      expect(mock.db.data.departments.find((d) => d.id === created.id)).toBeDefined();
      expect(mock.db.data.auditLog.slice(logSize)).toEqual([
        expect.objectContaining({
          action: 'created',
          entityType: 'department',
          entityId: created.id,
          actorId: adminId,
          changes: [
            { field: 'name', oldValue: null, newValue: 'Legal' },
            { field: 'status', oldValue: null, newValue: 'active' },
          ],
        }),
      ]);
    });

    it('answers 201', async () => {
      const { mock } = setup();

      const response = await mock.fetch('/api/v1/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Legal', description: 'Contracts and compliance.' }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ description: 'Contracts and compliance.' });
    });

    it('answers 409 for a name already in use, ignoring case, also by an inactive department', async () => {
      const { api, mock } = setup();
      const logSize = mock.db.data.auditLog.length;

      for (const name of ['finance', 'FACILITIES']) {
        const error = await failure(firstValueFrom(api.post('/departments', { body: { name } })));
        expect(error.status).toBe(409);
        expect(error.problem.type).toBe(ProblemType.conflict);
        expect(error.fieldErrors).toEqual([
          expect.objectContaining({ location: 'body', field: 'name', code: 'not_unique' }),
        ]);
      }
      expect(mock.db.data.departments).toHaveLength(9);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 422 with every invalid field, and logs nothing', async () => {
      const { mock } = setup();
      const logSize = mock.db.data.auditLog.length;

      const response = await mock.fetch('/api/v1/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ' ', description: 'x'.repeat(501), status: 'inactive' }),
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.type).toBe(ProblemType.validationFailed);
      expect(body.errors).toEqual([
        expect.objectContaining({ field: 'status', code: 'invalid_value' }),
        expect.objectContaining({ field: 'name', code: 'required' }),
        expect.objectContaining({ field: 'description', code: 'too_long' }),
      ]);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 422 for a missing or too long name', async () => {
      const { api } = setup();

      const missing = await failure(
        firstValueFrom(api.post('/departments', { body: {} as { name: string } })),
      );
      const tooLong = await failure(
        firstValueFrom(api.post('/departments', { body: { name: 'x'.repeat(101) } })),
      );

      expect(missing.fieldErrors).toEqual([
        expect.objectContaining({ field: 'name', code: 'required' }),
      ]);
      expect(tooLong.fieldErrors).toEqual([
        expect.objectContaining({ field: 'name', code: 'too_long' }),
      ]);
    });

    it('answers 400 for a body that is not a JSON object', async () => {
      const { mock } = setup();

      const response = await mock.fetch('/api/v1/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '["Legal"]',
      });

      expect(response.status).toBe(400);
    });
  });

  describe('update', () => {
    it('renames a department and logs only the changed field', async () => {
      const { api, mock } = setup();
      const sales = departmentNamed(mock, 'Sales');
      const logSize = mock.db.data.auditLog.length;

      const updated = await firstValueFrom(
        api.patch('/departments/{departmentId}', {
          path: { departmentId: sales.id },
          body: { name: 'Sales & Partnerships', description: null },
        }),
      );

      expect(updated).toMatchObject({
        name: 'Sales & Partnerships',
        description: null,
        status: 'active',
        updatedAt: TEST_NOW.toISOString(),
      });
      expect(mock.db.data.auditLog.slice(logSize)).toEqual([
        expect.objectContaining({
          action: 'updated',
          entityId: sales.id,
          changes: [{ field: 'name', oldValue: 'Sales', newValue: 'Sales & Partnerships' }],
        }),
      ]);
    });

    it('keeps its own name when only the case changes', async () => {
      const { api, mock } = setup();
      const sales = departmentNamed(mock, 'Sales');

      const updated = await firstValueFrom(
        api.patch('/departments/{departmentId}', {
          path: { departmentId: sales.id },
          body: { name: 'SALES' },
        }),
      );

      expect(updated.name).toBe('SALES');
    });

    it('logs nothing and keeps updatedAt when nothing changes', async () => {
      const { api, mock } = setup();
      const sales = departmentNamed(mock, 'Sales');
      const { updatedAt } = sales;
      const logSize = mock.db.data.auditLog.length;

      const updated = await firstValueFrom(
        api.patch('/departments/{departmentId}', {
          path: { departmentId: sales.id },
          body: { name: 'Sales', status: 'active' },
        }),
      );

      expect(updated.updatedAt).toBe(updatedAt);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('deactivates and reactivates, logged as deactivated and reactivated', async () => {
      const { api, mock } = setup();
      const finance = departmentNamed(mock, 'Finance');
      const members = mock.db.data.users.filter((u) => u.departmentId === finance.id).length;
      const logSize = mock.db.data.auditLog.length;
      const path = { departmentId: finance.id };

      const deactivated = await firstValueFrom(
        api.patch('/departments/{departmentId}', { path, body: { status: 'inactive' } }),
      );
      const reactivated = await firstValueFrom(
        api.patch('/departments/{departmentId}', { path, body: { status: 'active' } }),
      );

      expect(deactivated.status).toBe('inactive');
      expect(reactivated.status).toBe('active');
      // Employees keep their department.
      expect(mock.db.data.users.filter((u) => u.departmentId === finance.id)).toHaveLength(members);
      expect(deactivated.employeeCount).toBe(reactivated.employeeCount);
      expect(
        mock.db.data.auditLog.slice(logSize).map((entry) => [entry.action, entry.changes]),
      ).toEqual([
        ['deactivated', []],
        ['reactivated', []],
      ]);
    });

    it('logs a rename with a status change as updated, then deactivated', async () => {
      const { api, mock } = setup();
      const marketing = departmentNamed(mock, 'Marketing');
      const logSize = mock.db.data.auditLog.length;

      await firstValueFrom(
        api.patch('/departments/{departmentId}', {
          path: { departmentId: marketing.id },
          body: { name: 'Brand', status: 'inactive' },
        }),
      );

      const entries = mock.db.data.auditLog.slice(logSize);
      expect(entries.map((entry) => entry.action)).toEqual(['updated', 'deactivated']);
      expect(entries[0].changes).toEqual([
        { field: 'name', oldValue: 'Marketing', newValue: 'Brand' },
      ]);
    });

    it('answers 409 for a name another department uses', async () => {
      const { api, mock } = setup();
      const sales = departmentNamed(mock, 'Sales');

      const error = await failure(
        firstValueFrom(
          api.patch('/departments/{departmentId}', {
            path: { departmentId: sales.id },
            body: { name: 'Marketing' },
          }),
        ),
      );

      expect(error.status).toBe(409);
      expect(error.fieldErrors[0]).toMatchObject({ field: 'name', code: 'not_unique' });
      expect(sales.name).toBe('Sales');
    });

    it('answers 422 for invalid fields and unknown ones, and changes nothing', async () => {
      const { mock } = setup();
      const sales = departmentNamed(mock, 'Sales');
      const logSize = mock.db.data.auditLog.length;

      const response = await mock.fetch(`/api/v1/departments/${sales.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '', status: 'archived', employeeCount: 3 }),
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.errors.map((e: { field: string }) => e.field)).toEqual([
        'employeeCount',
        'name',
        'status',
      ]);
      expect(sales.name).toBe('Sales');
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 404 for an unknown department', async () => {
      const { api } = setup();

      const error = await failure(
        firstValueFrom(
          api.patch('/departments/{departmentId}', {
            path: { departmentId: 'nope' },
            body: { name: 'Legal' },
          }),
        ),
      );

      expect(error.isNotFound).toBe(true);
    });
  });

  describe('as an employee', () => {
    it('answers 403 on every endpoint and changes nothing', async () => {
      const { mock } = setup({ signedInAs: 'employee' });
      const sales = departmentNamed(mock, 'Sales');
      const logSize = mock.db.data.auditLog.length;
      const json = { 'Content-Type': 'application/json' };

      const responses = await Promise.all([
        mock.fetch('/api/v1/departments'),
        mock.fetch(`/api/v1/departments/${sales.id}`),
        // Invalid bodies still get 403: the role is checked before validation.
        mock.fetch('/api/v1/departments', { method: 'POST', headers: json, body: '{}' }),
        mock.fetch(`/api/v1/departments/${sales.id}`, {
          method: 'PATCH',
          headers: json,
          body: JSON.stringify({ status: 'inactive' }),
        }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((await response.json()).type).toBe(ProblemType.forbidden);
      }
      expect(sales.status).toBe('active');
      expect(mock.db.data.departments).toHaveLength(9);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });
  });
});
