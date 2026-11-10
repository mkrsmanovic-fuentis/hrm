import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../app/core/api/api-client';
import { ApiError, ProblemType } from '../../../app/core/api/api-error';
import type { QuestionnaireCreate } from '../../../app/core/api/api-schema.gen';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

describe('questionnaires mock handlers', () => {
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

  const topicId = (mock: Mock, name: string) => {
    const topic = mock.db.data.topics.find((t) => t.name === name);
    if (!topic) throw new Error(`No seeded topic ${name}`);
    return topic.id;
  };
  const questionnaire = (mock: Mock, title: string) => {
    const found = mock.db.data.questionnaires.find((q) => q.title === title);
    if (!found) throw new Error(`No seeded questionnaire ${title}`);
    return found;
  };

  const json = { 'Content-Type': 'application/json' };
  const DRAFT = 'Reporting suspicious messages';

  describe('list', () => {
    it('lists every questionnaire, active and inactive, with its question count, sorted by title', async () => {
      const { api, mock } = setup();

      const result = await firstValueFrom(api.get('/questionnaires', { query: { pageSize: 100 } }));

      expect(result.page.totalItems).toBe(mock.db.data.questionnaires.length);
      const titles = result.items.map((q) => q.title);
      expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
      expect(result.items.map((q) => q.status)).toContain('inactive');
      const draft = result.items.find((q) => q.title === DRAFT);
      expect(draft).toMatchObject({ status: 'inactive', questionCount: 0 });
      const phishing = result.items.find((q) => q.title === 'Spotting phishing emails');
      expect(phishing?.questionCount).toBeGreaterThan(0);
    });

    it('filters by status and topic, searches titles ignoring case, and sorts', async () => {
      const { api, mock } = setup();
      const password = topicId(mock, 'Password Security');

      const inactive = await firstValueFrom(
        api.get('/questionnaires', { query: { status: 'inactive' } }),
      );
      const inTopic = await firstValueFrom(
        api.get('/questionnaires', { query: { topicId: password } }),
      );
      const search = await firstValueFrom(
        api.get('/questionnaires', { query: { q: ' PHISHING ' } }),
      );
      const byScore = await firstValueFrom(
        api.get('/questionnaires', { query: { sort: '-passingScore' } }),
      );

      expect(inactive.items.map((q) => q.title)).toEqual(['Password basics (2025)', DRAFT]);
      expect(inTopic.items.map((q) => q.title)).toEqual([
        'Multi-factor authentication',
        'Password basics (2025)',
        'Strong passwords and password managers',
      ]);
      expect(search.items.map((q) => q.title)).toEqual([
        'Phishing beyond email',
        'Spotting phishing emails',
      ]);
      const scores = byScore.items.map((q) => q.passingScore);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('answers invalid query parameters with a validation problem', async () => {
      const { mock } = setup();

      const response = await mock.fetch(
        `/api/v1/questionnaires?status=draft&q=${'x'.repeat(201)}&sort=topic`,
      );
      const body = await response.json();

      expect(response.status).toBe(422);
      expect(body.errors).toEqual([
        expect.objectContaining({ location: 'query', field: 'status', code: 'invalid_value' }),
        expect.objectContaining({ location: 'query', field: 'q', code: 'too_long' }),
        expect.objectContaining({ location: 'query', field: 'sort', code: 'invalid_value' }),
      ]);
    });
  });

  describe('get one', () => {
    it('returns a questionnaire with its count, and 404 for an unknown ID', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, 'Handling personal data');

      const result = await firstValueFrom(
        api.get('/questionnaires/{questionnaireId}', { path: { questionnaireId: record.id } }),
      );
      expect(result).toEqual({ ...record, questionCount: expect.any(Number) });
      expect(result.questionCount).toBe(
        mock.db.data.questions.filter((q) => q.questionnaireVersionId === record.currentVersionId)
          .length,
      );

      const error = await failure(
        firstValueFrom(
          api.get('/questionnaires/{questionnaireId}', { path: { questionnaireId: 'missing' } }),
        ),
      );
      expect(error.isNotFound).toBe(true);
    });
  });

  describe('create', () => {
    it('creates an inactive draft with an empty version 1 and the defaults, and logs it', async () => {
      const { api, mock, adminId } = setup();
      const logSize = mock.db.data.auditLog.length;
      const topic = topicId(mock, 'Device Security');

      const created = await firstValueFrom(
        api.post('/questionnaires', {
          body: { title: '  USB sticks  ', description: '  ', topicId: topic },
        }),
      );

      expect(created).toMatchObject({
        title: 'USB sticks',
        description: null,
        topicId: topic,
        passingScore: 80,
        timeLimitMinutes: null,
        status: 'inactive',
        questionCount: 0,
        organizationId: mock.db.data.organization.id,
        createdAt: TEST_NOW.toISOString(),
        updatedAt: TEST_NOW.toISOString(),
      });
      const versions = mock.db.data.questionnaireVersions.filter(
        (v) => v.questionnaireId === created.id,
      );
      expect(versions).toEqual([
        expect.objectContaining({ id: created.currentVersionId, versionNumber: 1 }),
      ]);
      expect(mock.db.data.auditLog.slice(logSize)).toEqual([
        expect.objectContaining({
          action: 'created',
          entityType: 'questionnaire',
          entityId: created.id,
          actorId: adminId,
          changes: [
            { field: 'topicId', oldValue: null, newValue: topic },
            { field: 'title', oldValue: null, newValue: 'USB sticks' },
            { field: 'passingScore', oldValue: null, newValue: 80 },
            { field: 'status', oldValue: null, newValue: 'inactive' },
            { field: 'currentVersionId', oldValue: null, newValue: created.currentVersionId },
          ],
        }),
      ]);
    });

    it('answers 201 with the passing score and time limit sent, and allows a title already in use', async () => {
      const { mock } = setup();

      const response = await mock.fetch('/api/v1/questionnaires', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          title: 'Spotting phishing emails',
          description: 'A second one, for a different topic.',
          topicId: topicId(mock, 'Social Engineering'),
          passingScore: 1,
          timeLimitMinutes: 480,
        }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ passingScore: 1, timeLimitMinutes: 480 });
      expect(
        mock.db.data.questionnaires.filter((q) => q.title === 'Spotting phishing emails'),
      ).toHaveLength(2);
    });

    it('answers 422 with every invalid field, including passing score bounds, and logs nothing', async () => {
      const { mock } = setup();
      const count = mock.db.data.questionnaires.length;
      const logSize = mock.db.data.auditLog.length;

      const send = async (body: object) => {
        const response = await mock.fetch('/api/v1/questionnaires', {
          method: 'POST',
          headers: json,
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(422);
        return (await response.json()).errors as { field: string; code: string }[];
      };

      expect(
        await send({
          title: ' ',
          description: 'x'.repeat(2001),
          topicId: topicId(mock, 'Data Protection'),
          passingScore: 0,
          timeLimitMinutes: 0,
          status: 'active',
        }),
      ).toEqual([
        expect.objectContaining({ field: 'status', code: 'invalid_value' }),
        expect.objectContaining({ field: 'title', code: 'required' }),
        expect.objectContaining({ field: 'description', code: 'too_long' }),
        expect.objectContaining({ field: 'passingScore', code: 'out_of_range' }),
        expect.objectContaining({ field: 'timeLimitMinutes', code: 'out_of_range' }),
      ]);
      const topic = topicId(mock, 'Data Protection');
      expect(await send({ title: 'A', topicId: topic, passingScore: 101 })).toEqual([
        expect.objectContaining({ field: 'passingScore', code: 'out_of_range' }),
      ]);
      expect(
        await send({ title: 'A', topicId: topic, passingScore: 79.5, timeLimitMinutes: '10' }),
      ).toEqual([
        expect.objectContaining({ field: 'passingScore', code: 'invalid_type' }),
        expect.objectContaining({ field: 'timeLimitMinutes', code: 'invalid_type' }),
      ]);
      expect(await send({ title: 'A', topicId: topic, timeLimitMinutes: 481 })).toEqual([
        expect.objectContaining({ field: 'timeLimitMinutes', code: 'out_of_range' }),
      ]);
      expect(await send({})).toEqual([
        expect.objectContaining({ field: 'title', code: 'required' }),
        expect.objectContaining({ field: 'topicId', code: 'required' }),
      ]);
      expect(mock.db.data.questionnaires).toHaveLength(count);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('rejects an inactive or unknown topic on topicId', async () => {
      const { api, mock } = setup();
      const count = mock.db.data.questionnaires.length;
      const create = (body: QuestionnaireCreate) =>
        failure(firstValueFrom(api.post('/questionnaires', { body })));

      const inactive = await create({
        title: 'Clear desks',
        topicId: topicId(mock, 'Clean Desk Policy'),
      });
      const unknown = await create({ title: 'Clear desks', topicId: 'missing' });

      expect(inactive.status).toBe(422);
      expect(inactive.fieldErrors).toEqual([
        expect.objectContaining({
          location: 'body',
          field: 'topicId',
          code: 'invalid_value',
          message: 'This topic is inactive. Choose an active topic.',
        }),
      ]);
      expect(unknown.fieldErrors).toEqual([
        expect.objectContaining({ field: 'topicId', message: 'Choose an existing topic.' }),
      ]);
      expect(mock.db.data.questionnaires).toHaveLength(count);
    });
  });

  describe('update', () => {
    it('changes the settings without a new version, and logs only the changed fields', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, 'Browsing and downloads');
      const { currentVersionId } = record;
      const versionCount = mock.db.data.questionnaireVersions.length;
      const logSize = mock.db.data.auditLog.length;
      const newTopic = topicId(mock, 'Device Security');

      const updated = await firstValueFrom(
        api.patch('/questionnaires/{questionnaireId}', {
          path: { questionnaireId: record.id },
          body: {
            title: ' Safe browsing ',
            description: record.description,
            topicId: newTopic,
            passingScore: 75,
            timeLimitMinutes: 20,
          },
        }),
      );

      expect(updated).toMatchObject({
        title: 'Safe browsing',
        topicId: newTopic,
        passingScore: 75,
        timeLimitMinutes: 20,
        status: 'active',
        currentVersionId,
        updatedAt: TEST_NOW.toISOString(),
      });
      expect(mock.db.data.questionnaireVersions).toHaveLength(versionCount);
      expect(mock.db.data.auditLog.slice(logSize)).toEqual([
        expect.objectContaining({
          action: 'updated',
          entityType: 'questionnaire',
          entityId: record.id,
          changes: [
            {
              field: 'topicId',
              oldValue: topicId(mock, 'Safe Internet Usage'),
              newValue: newTopic,
            },
            { field: 'title', oldValue: 'Browsing and downloads', newValue: 'Safe browsing' },
            { field: 'passingScore', oldValue: 80, newValue: 75 },
            { field: 'timeLimitMinutes', oldValue: null, newValue: 20 },
          ],
        }),
      ]);
    });

    it('keeps the passing score of attempts already started', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, 'Spotting phishing emails');
      const versions = new Set(
        mock.db.data.questionnaireVersions
          .filter((v) => v.questionnaireId === record.id)
          .map((v) => v.id),
      );
      const attempts = () =>
        mock.db.data.attempts
          .filter((a) => versions.has(a.questionnaireVersionId))
          .map((a) => ({ passingScore: a.passingScore, passed: a.passed }));
      const before = attempts();

      await firstValueFrom(
        api.patch('/questionnaires/{questionnaireId}', {
          path: { questionnaireId: record.id },
          body: { passingScore: 100 },
        }),
      );

      expect(before.length).toBeGreaterThan(0);
      expect(attempts()).toEqual(before);
    });

    it('logs nothing and keeps updatedAt when nothing changes', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, 'Handling personal data');
      const { updatedAt } = record;
      const logSize = mock.db.data.auditLog.length;

      const updated = await firstValueFrom(
        api.patch('/questionnaires/{questionnaireId}', {
          path: { questionnaireId: record.id },
          body: { title: record.title, passingScore: record.passingScore, status: 'active' },
        }),
      );

      expect(updated.updatedAt).toBe(updatedAt);
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('rejects a move into an inactive topic, but keeps a questionnaire that is already in one', async () => {
      const { api, mock } = setup();
      const cleanDesk = topicId(mock, 'Clean Desk Policy');
      const record = questionnaire(mock, 'Recognizing manipulation');
      const path = { questionnaireId: record.id };

      const error = await failure(
        firstValueFrom(
          api.patch('/questionnaires/{questionnaireId}', { path, body: { topicId: cleanDesk } }),
        ),
      );
      expect(error.status).toBe(422);
      expect(error.fieldErrors).toEqual([
        expect.objectContaining({ field: 'topicId', code: 'invalid_value' }),
      ]);
      expect(record.topicId).toBe(topicId(mock, 'Social Engineering'));

      // A questionnaire whose topic was deactivated later stays as it is, and can still be edited.
      mock.db.update(() => {
        record.topicId = cleanDesk;
      });
      const updated = await firstValueFrom(
        api.patch('/questionnaires/{questionnaireId}', {
          path,
          body: { topicId: cleanDesk, title: 'Clean desks and manipulation' },
        }),
      );
      expect(updated).toMatchObject({ topicId: cleanDesk, title: 'Clean desks and manipulation' });
    });

    it('blocks activation without questions with 409, and changes nothing', async () => {
      const { api, mock } = setup();
      const draft = questionnaire(mock, DRAFT);
      const logSize = mock.db.data.auditLog.length;

      const error = await failure(
        firstValueFrom(
          api.patch('/questionnaires/{questionnaireId}', {
            path: { questionnaireId: draft.id },
            body: { status: 'active', title: 'Reporting phishing' },
          }),
        ),
      );

      expect(error.status).toBe(409);
      expect(error.problem.type).toBe(ProblemType.conflict);
      expect(error.problem.detail).toBe(
        'Add at least one question before activating this questionnaire.',
      );
      expect(draft).toMatchObject({ status: 'inactive', title: DRAFT });
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });

    it('deactivates and reactivates a questionnaire with questions, keeps assignments, and logs both', async () => {
      const { api, mock } = setup();
      const record = questionnaire(mock, 'Multi-factor authentication');
      const assignments = () =>
        mock.db.data.assignments.filter((a) => a.questionnaireId === record.id).length;
      const assigned = assignments();
      const logSize = mock.db.data.auditLog.length;
      const path = { questionnaireId: record.id };

      const deactivated = await firstValueFrom(
        api.patch('/questionnaires/{questionnaireId}', { path, body: { status: 'inactive' } }),
      );
      const reactivated = await firstValueFrom(
        api.patch('/questionnaires/{questionnaireId}', { path, body: { status: 'active' } }),
      );

      expect(deactivated.status).toBe('inactive');
      expect(reactivated.status).toBe('active');
      expect(assignments()).toBe(assigned);
      expect(
        mock.db.data.auditLog.slice(logSize).map((entry) => [entry.action, entry.changes]),
      ).toEqual([
        ['deactivated', []],
        ['reactivated', []],
      ]);
    });

    it('answers 422 for invalid and unknown fields, 404 for an unknown ID, and changes nothing', async () => {
      const { mock } = setup();
      const record = questionnaire(mock, 'Handling personal data');
      const logSize = mock.db.data.auditLog.length;

      const response = await mock.fetch(`/api/v1/questionnaires/${record.id}`, {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify({
          title: '',
          passingScore: null,
          timeLimitMinutes: -5,
          status: 'draft',
          questionCount: 3,
          currentVersionId: 'other',
        }),
      });
      const body = await response.json();
      const missing = await mock.fetch('/api/v1/questionnaires/missing', {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify({ title: 'X' }),
      });

      expect(response.status).toBe(422);
      expect(body.errors.map((e: { field: string }) => e.field)).toEqual([
        'questionCount',
        'currentVersionId',
        'title',
        'passingScore',
        'timeLimitMinutes',
        'status',
      ]);
      expect(missing.status).toBe(404);
      expect(record.title).toBe('Handling personal data');
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });
  });

  describe('access', () => {
    it('answers 403 to employees on every endpoint, before validating, and changes nothing', async () => {
      const { mock } = setup({ signedInAs: 'employee' });
      const record = questionnaire(mock, 'Handling personal data');
      const count = mock.db.data.questionnaires.length;
      const logSize = mock.db.data.auditLog.length;

      const responses = await Promise.all([
        mock.fetch('/api/v1/questionnaires'),
        mock.fetch(`/api/v1/questionnaires/${record.id}`),
        mock.fetch('/api/v1/questionnaires', {
          method: 'POST',
          headers: json,
          body: JSON.stringify({}),
        }),
        mock.fetch(`/api/v1/questionnaires/${record.id}`, {
          method: 'PATCH',
          headers: json,
          body: JSON.stringify({ status: 'inactive' }),
        }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((await response.json()).type).toBe(ProblemType.forbidden);
      }
      expect(mock.db.data.questionnaires).toHaveLength(count);
      expect(record.status).toBe('active');
      expect(mock.db.data.auditLog).toHaveLength(logSize);
    });
  });
});
