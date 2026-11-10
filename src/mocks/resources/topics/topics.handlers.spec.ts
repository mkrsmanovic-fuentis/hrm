import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../app/core/api/api-client';
import { ApiError, ProblemType } from '../../../app/core/api/api-error';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

describe('topics mock handlers', () => {
  function setup(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const admin = mock.db.data.users.find(
      (user) => user.role === 'administrator' && user.status === 'active',
    );
    return { api: TestBed.inject(ApiClient), mock, adminId: admin?.id };
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

  function topicNamed(mock: Mock, name: string) {
    const topic = mock.db.data.topics.find((t) => t.name === name);
    if (!topic) throw new Error(`No seeded topic ${name}`);
    return topic;
  }

  const json = { 'Content-Type': 'application/json' };

  describe('list', () => {
    it('lists every topic, active and inactive, sorted by name, one page at a time', async () => {
      const { api } = setup();

      const result = await firstValueFrom(api.get('/topics', { query: { pageSize: 3, page: 2 } }));

      expect(result.items.map((topic) => topic.name)).toEqual([
        'Password Security',
        'Phishing Awareness',
        'Remote Work Security',
      ]);
      expect(result.page).toEqual({ page: 2, pageSize: 3, totalItems: 8, totalPages: 3 });
    });

    it('counts every questionnaire in the topic, active and inactive', async () => {
      const { api, mock } = setup();
      const password = topicNamed(mock, 'Password Security');
      const inTopic = mock.db.data.questionnaires.filter((q) => q.topicId === password.id);

      const result = await firstValueFrom(
        api.get('/topics/{topicId}', { path: { topicId: password.id } }),
      );

      expect(inTopic.map((q) => q.status)).toContain('inactive');
      expect(result.questionnaireCount).toBe(inTopic.length);
      const cleanDesk = await firstValueFrom(
        api.get('/topics/{topicId}', {
          path: { topicId: topicNamed(mock, 'Clean Desk Policy').id },
        }),
      );
      expect(cleanDesk.questionnaireCount).toBe(0);
    });

    it('filters by status, searches names ignoring case, and sorts', async () => {
      const { api } = setup();

      const inactive = await firstValueFrom(api.get('/topics', { query: { status: 'inactive' } }));
      const search = await firstValueFrom(api.get('/topics', { query: { q: '  SECURITY ' } }));
      const byCount = await firstValueFrom(
        api.get('/topics', { query: { sort: '-questionnaireCount' } }),
      );
      const descending = await firstValueFrom(api.get('/topics', { query: { sort: '-name' } }));

      expect(inactive.items.map((t) => t.name)).toEqual(['Clean Desk Policy']);
      expect(search.items.map((t) => t.name)).toEqual([
        'Device Security',
        'Password Security',
        'Remote Work Security',
      ]);
      const counts = byCount.items.map((t) => t.questionnaireCount);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(descending.items[0].name).toBe('Social Engineering');
    });

    it('answers invalid query parameters with a validation problem', async () => {
      const { mock } = setup();

      const response = await mock.fetch(
        `/api/v1/topics?pageSize=500&status=archived&q=${'x'.repeat(101)}&sort=icon`,
      );
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json');
      expect(body).toMatchObject({ type: ProblemType.validationFailed, status: 422 });
      expect(body.errors).toEqual([
        expect.objectContaining({ location: 'query', field: 'pageSize', code: 'out_of_range' }),
        expect.objectContaining({ location: 'query', field: 'status', code: 'invalid_value' }),
        expect.objectContaining({ location: 'query', field: 'q', code: 'too_long' }),
        expect.objectContaining({ location: 'query', field: 'sort', code: 'invalid_value' }),
      ]);
    });
  });

  describe('get one', () => {
    it('returns a topic with its count, and 404 for an unknown ID', async () => {
      const { api, mock } = setup();
      const topic = topicNamed(mock, 'Data Protection');

      await expect(
        firstValueFrom(api.get('/topics/{topicId}', { path: { topicId: topic.id } })),
      ).resolves.toEqual({ ...topic, questionnaireCount: expect.any(Number) });

      const error = await failure(
        firstValueFrom(api.get('/topics/{topicId}', { path: { topicId: 'missing' } })),
      );
      expect(error.isNotFound).toBe(true);
      expect(error.problem.type).toBe(ProblemType.notFound);
    });
  });

  describe('create', () => {
    it('creates an active topic, trims the fields, and logs it', async () => {
      const { api, mock, adminId } = setup();
      const logSize = mock.db.data.auditLog.length;

      const created = await firstValueFrom(
        api.post('/topics', {
          body: {
            name: '  Mobile Security ',
            description: ' Keep phones safe. ',
            icon: 'smartphone',
          },
        }),
      );

      expect(created).toMatchObject({
        name: 'Mobile Security',
        description: 'Keep phones safe.',
        icon: 'smartphone',
        status: 'active',
        questionnaireCount: 0,
        organizationId: mock.db.data.organization.id,
        createdAt: TEST_NOW.toISOString(),
        updatedAt: TEST_NOW.toISOString(),
      });
      expect(mock.db.data.topics.find((t) => t.id === created.id)).toBeDefined();
      expect(mock.db.data.auditLog.slice(logSize)).toEqual([
        expect.objectContaining({
          action: 'created',
          entityType: 'topic',
          entityId: created.id,
          actorId: adminId,
          changes: [
            { field: 'name', oldValue: null, newValue: 'Mobile Security' },
            { field: 'description', oldValue: null, newValue: 'Keep phones safe.' },
            { field: 'icon', oldValue: null, newValue: 'smartphone' },
            { field: 'status', oldValue: null, newValue: 'active' },
          ],
        }),
      ]);
    });

    it('answers 201, and saves a topic without an icon', async () => {
      const { mock } = setup();

      const response = await mock.fetch('/api/v1/topics', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Insider Threats', description: 'Spot risky behavior.' }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ name: 'Insider Threats', icon: null });
    });

    it('answers 409 for a name already in use, ignoring case and spaces, also by an inactive topic', async () => {
      const { api, mock } = setup();
      const logSize = mock.db.data.auditLog.length;

      for (const name of ['phishing awareness', '  CLEAN DESK POLICY  ']) {
        const error = await failure(
          firstValueFrom(api.post('/topics', { body: { name, description: 'Again.' } })),
        );
        expect(error.status).toBe(409);
        expect(error.problem.type).toBe(ProblemType.conflict);
        expect(error.fieldErrors).toEqual([
          expect.objectContaining({ location: 'body', field: 'name', code: 'not_unique' }),
        ]);
      }
      expect(mock.db.data.topics).toHaveLength(8);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 422 with every invalid field, and logs nothing', async () => {
      const { mock } = setup();
      const logSize = mock.db.data.auditLog.length;

      const response = await mock.fetch('/api/v1/topics', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          name: ' ',
          description: 'x'.repeat(1001),
          icon: 'rocket',
          status: 'inactive',
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.type).toBe(ProblemType.validationFailed);
      expect(body.errors).toEqual([
        expect.objectContaining({ field: 'status', code: 'invalid_value' }),
        expect.objectContaining({ field: 'name', code: 'required' }),
        expect.objectContaining({ field: 'description', code: 'too_long' }),
        expect.objectContaining({ field: 'icon', code: 'invalid_value' }),
      ]);
      expect(mock.db.data.topics).toHaveLength(8);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 422 for a missing name and description', async () => {
      const { api } = setup();

      const error = await failure(
        firstValueFrom(api.post('/topics', { body: {} as { name: string; description: string } })),
      );

      expect(error.fieldErrors).toEqual([
        expect.objectContaining({ field: 'name', code: 'required' }),
        expect.objectContaining({ field: 'description', code: 'required' }),
      ]);
    });
  });

  describe('update', () => {
    it('changes the name and icon, and logs only the changed fields', async () => {
      const { api, mock } = setup();
      const topic = topicNamed(mock, 'Device Security');
      const logSize = mock.db.data.auditLog.length;

      const updated = await firstValueFrom(
        api.patch('/topics/{topicId}', {
          path: { topicId: topic.id },
          body: { name: 'Device and Mobile Security', description: topic.description, icon: null },
        }),
      );

      expect(updated).toMatchObject({
        name: 'Device and Mobile Security',
        icon: null,
        status: 'active',
        updatedAt: TEST_NOW.toISOString(),
      });
      expect(mock.db.data.auditLog.slice(logSize)).toEqual([
        expect.objectContaining({
          action: 'updated',
          entityType: 'topic',
          entityId: topic.id,
          changes: [
            { field: 'name', oldValue: 'Device Security', newValue: 'Device and Mobile Security' },
            { field: 'icon', oldValue: 'laptop', newValue: null },
          ],
        }),
      ]);
    });

    it('keeps its own name when only the case changes', async () => {
      const { api, mock } = setup();
      const topic = topicNamed(mock, 'Data Protection');

      const updated = await firstValueFrom(
        api.patch('/topics/{topicId}', {
          path: { topicId: topic.id },
          body: { name: 'DATA PROTECTION' },
        }),
      );

      expect(updated.name).toBe('DATA PROTECTION');
    });

    it('logs nothing and keeps updatedAt when nothing changes', async () => {
      const { api, mock } = setup();
      const topic = topicNamed(mock, 'Data Protection');
      const { updatedAt } = topic;
      const logSize = mock.db.data.auditLog.length;

      const updated = await firstValueFrom(
        api.patch('/topics/{topicId}', {
          path: { topicId: topic.id },
          body: { name: 'Data Protection', icon: 'shield-check', status: 'active' },
        }),
      );

      expect(updated.updatedAt).toBe(updatedAt);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('deactivates and reactivates, keeps the questionnaires, and logs both', async () => {
      const { api, mock } = setup();
      const topic = topicNamed(mock, 'Phishing Awareness');
      const questionnaires = () =>
        mock.db.data.questionnaires
          .filter((q) => q.topicId === topic.id)
          .map((q) => ({ id: q.id, status: q.status }));
      const before = questionnaires();
      const logSize = mock.db.data.auditLog.length;
      const path = { topicId: topic.id };

      const deactivated = await firstValueFrom(
        api.patch('/topics/{topicId}', { path, body: { status: 'inactive' } }),
      );
      expect(questionnaires()).toEqual(before);
      const reactivated = await firstValueFrom(
        api.patch('/topics/{topicId}', { path, body: { status: 'active' } }),
      );

      expect(deactivated.status).toBe('inactive');
      expect(deactivated.questionnaireCount).toBe(before.length);
      expect(reactivated.status).toBe('active');
      expect(questionnaires()).toEqual(before);
      expect(
        mock.db.data.auditLog.slice(logSize).map((entry) => [entry.action, entry.changes]),
      ).toEqual([
        ['deactivated', []],
        ['reactivated', []],
      ]);
    });

    it('logs a rename with a status change as updated, then deactivated', async () => {
      const { api, mock } = setup();
      const topic = topicNamed(mock, 'Social Engineering');
      const logSize = mock.db.data.auditLog.length;

      await firstValueFrom(
        api.patch('/topics/{topicId}', {
          path: { topicId: topic.id },
          body: { name: 'Manipulation', status: 'inactive' },
        }),
      );

      const entries = mock.db.data.auditLog.slice(logSize);
      expect(entries.map((entry) => entry.action)).toEqual(['updated', 'deactivated']);
      expect(entries[0].changes).toEqual([
        { field: 'name', oldValue: 'Social Engineering', newValue: 'Manipulation' },
      ]);
    });

    it('answers 409 for a name another topic uses', async () => {
      const { api, mock } = setup();
      const topic = topicNamed(mock, 'Data Protection');

      const error = await failure(
        firstValueFrom(
          api.patch('/topics/{topicId}', {
            path: { topicId: topic.id },
            body: { name: ' clean desk policy ' },
          }),
        ),
      );

      expect(error.status).toBe(409);
      expect(error.fieldErrors[0]).toMatchObject({ field: 'name', code: 'not_unique' });
      expect(topic.name).toBe('Data Protection');
    });

    it('answers 422 for invalid fields and unknown ones, and changes nothing', async () => {
      const { mock } = setup();
      const topic = topicNamed(mock, 'Data Protection');
      const logSize = mock.db.data.auditLog.length;

      const response = await mock.fetch(`/api/v1/topics/${topic.id}`, {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify({
          name: '',
          description: null,
          icon: 'rocket',
          status: 'archived',
          questionnaireCount: 3,
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.errors.map((e: { field: string }) => e.field)).toEqual([
        'questionnaireCount',
        'name',
        'description',
        'icon',
        'status',
      ]);
      expect(topic.name).toBe('Data Protection');
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('answers 404 for an unknown topic', async () => {
      const { api } = setup();

      const error = await failure(
        firstValueFrom(
          api.patch('/topics/{topicId}', { path: { topicId: 'nope' }, body: { name: 'Legal' } }),
        ),
      );

      expect(error.isNotFound).toBe(true);
    });
  });

  describe('as an employee', () => {
    it('lists only active topics, even when asking for inactive ones', async () => {
      const { api, mock } = setup({ signedInAs: 'employee' });
      const inactive = topicNamed(mock, 'Clean Desk Policy');

      const all = await firstValueFrom(api.get('/topics'));
      const onlyInactive = await firstValueFrom(
        api.get('/topics', { query: { status: 'inactive' } }),
      );
      const search = await firstValueFrom(api.get('/topics', { query: { q: 'clean' } }));

      expect(all.page.totalItems).toBe(7);
      expect(all.items.map((topic) => topic.id)).not.toContain(inactive.id);
      expect(onlyInactive.items).toEqual([]);
      expect(search.items).toEqual([]);
    });

    it('answers 404 for an inactive topic, and returns an active one', async () => {
      const { api, mock } = setup({ signedInAs: 'employee' });
      const inactive = topicNamed(mock, 'Clean Desk Policy');
      const active = topicNamed(mock, 'Data Protection');

      const error = await failure(
        firstValueFrom(api.get('/topics/{topicId}', { path: { topicId: inactive.id } })),
      );
      expect(error.isNotFound).toBe(true);

      await expect(
        firstValueFrom(api.get('/topics/{topicId}', { path: { topicId: active.id } })),
      ).resolves.toMatchObject({ id: active.id, status: 'active' });
    });

    it('answers 403 to creating and changing topics, and changes nothing', async () => {
      const { mock } = setup({ signedInAs: 'employee' });
      const active = topicNamed(mock, 'Data Protection');
      const inactive = topicNamed(mock, 'Clean Desk Policy');
      const logSize = mock.db.data.auditLog.length;

      const responses = await Promise.all([
        // Invalid bodies still get 403: the role is checked before validation.
        mock.fetch('/api/v1/topics', { method: 'POST', headers: json, body: '{}' }),
        mock.fetch(`/api/v1/topics/${active.id}`, {
          method: 'PATCH',
          headers: json,
          body: JSON.stringify({ status: 'inactive' }),
        }),
        // Even for a topic the employee cannot see: the role is checked first.
        mock.fetch(`/api/v1/topics/${inactive.id}`, {
          method: 'PATCH',
          headers: json,
          body: JSON.stringify({ status: 'active' }),
        }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((await response.json()).type).toBe(ProblemType.forbidden);
      }
      expect(active.status).toBe('active');
      expect(inactive.status).toBe('inactive');
      expect(mock.db.data.topics).toHaveLength(8);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('administrators still see inactive topics', async () => {
      const { api, mock } = setup({ signedInAs: 'administrator' });
      const inactive = topicNamed(mock, 'Clean Desk Policy');

      await expect(
        firstValueFrom(api.get('/topics/{topicId}', { path: { topicId: inactive.id } })),
      ).resolves.toMatchObject({ id: inactive.id, status: 'inactive' });
    });
  });

  describe('simulation flags', () => {
    it('simulates access denied with the mock-error flag', async () => {
      const { api } = setup({ flags: { errorStatus: 403 } });

      const error = await failure(firstValueFrom(api.get('/topics')));

      expect(error.isForbidden).toBe(true);
      expect(error.problem.title).toBe('Access denied');
    });

    it('simulates empty lists, only within the flag scope', async () => {
      const { api } = setup({ flags: { empty: true, scope: '/topics' } });

      const result = await firstValueFrom(api.get('/topics'));
      const organization = await firstValueFrom(api.get('/organization'));

      expect(result.items).toEqual([]);
      expect(result.page.totalPages).toBe(0);
      expect(organization.name).toBe('Brightwater Logistics');
    });

    it('answers unknown API paths with a 404 problem', async () => {
      const { mock } = setup();

      const response = await mock.fetch('/api/v1/not-a-resource');

      expect(response.status).toBe(404);
      expect((await response.json()).detail).toContain('No mock handler');
    });
  });
});
