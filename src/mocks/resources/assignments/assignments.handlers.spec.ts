import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../app/core/api/api-client';
import { ApiError } from '../../../app/core/api/api-error';
import { toAssignment } from '../../rules/training-rules';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

describe('assignments mock handlers', () => {
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

  /** A week after the test's "now". */
  const DUE_AT = new Date(TEST_NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

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

  /** An active questionnaire in an active topic. */
  function assignable(mock: Mock) {
    const { questionnaires, topics } = mock.db.data;
    const found = questionnaires.find(
      (q) => q.status === 'active' && topics.find((t) => t.id === q.topicId)?.status === 'active',
    );
    if (!found) throw new Error('No assignable questionnaire in the seed');
    return found;
  }

  /** An assignable questionnaire none of the users has an assignment for. */
  function freshFor(mock: Mock, ...users: { id: string }[]) {
    const { questionnaires, topics, assignments } = mock.db.data;
    const found = questionnaires.find(
      (q) =>
        q.status === 'active' &&
        topics.find((t) => t.id === q.topicId)?.status === 'active' &&
        !assignments.some(
          (a) => a.questionnaireId === q.id && users.some((u) => u.id === a.userId),
        ),
    );
    if (!found) throw new Error('No questionnaire without assignments for these users');
    return found;
  }

  /** The derived status of each of the user's assignments for the questionnaire. */
  function statusesOf(mock: Mock, userId: string, questionnaireId: string) {
    return mock.db.data.assignments
      .filter((a) => a.userId === userId && a.questionnaireId === questionnaireId)
      .map((a) => toAssignment(a, mock.db.data, TEST_NOW).status);
  }

  /** A seeded assignment with the status, for an active employee. */
  function seededWithStatus(mock: Mock, open: boolean) {
    const { data } = mock.db;
    const found = data.assignments
      .map((a) => toAssignment(a, data, TEST_NOW))
      .find((a) => {
        const user = data.users.find((u) => u.id === a.userId);
        const questionnaire = data.questionnaires.find((q) => q.id === a.questionnaireId);
        const topic = data.topics.find((t) => t.id === questionnaire?.topicId);
        return (
          user?.status === 'active' &&
          questionnaire?.status === 'active' &&
          topic?.status === 'active' &&
          (open ? a.status !== 'passed' : a.status === 'passed') &&
          // Only one assignment for the pair, so it is the one being tested.
          statusesOf(mock, a.userId, a.questionnaireId).length === 1
        );
      });
    if (!found) throw new Error(`No ${open ? 'open' : 'passed'} assignment in the seed`);
    return found;
  }

  describe('create', () => {
    it('assigns a questionnaire to selected employees, with a notification and an audit entry each', async () => {
      const { api, mock, signedInId } = setup();
      const benjamin = userNamed(mock, 'Benjamin');
      const ruth = userNamed(mock, 'Ruth');
      const questionnaire = freshFor(mock, benjamin, ruth);

      const result = await firstValueFrom(
        api.post('/assignments', {
          body: {
            questionnaireId: questionnaire.id,
            userIds: [benjamin.id, ruth.id],
            dueAt: DUE_AT,
          },
        }),
      );

      expect(result.skipped).toEqual([]);
      expect(result.assignments).toHaveLength(2);
      expect(result.assignments[0]).toMatchObject({
        questionnaireId: questionnaire.id,
        userId: benjamin.id,
        assignedById: signedInId,
        dueAt: DUE_AT,
        status: 'not_started',
        attemptCount: 0,
        latestScore: null,
        completedAt: null,
        employeeName: 'Benjamin Weber',
        departmentId: null,
        departmentName: null,
        questionnaireTitle: questionnaire.title,
        createdAt: TEST_NOW.toISOString(),
      });
      for (const assignment of result.assignments) {
        expect(mock.db.data.notifications).toContainEqual(
          expect.objectContaining({
            userId: assignment.userId,
            type: 'assignment_created',
            assignmentId: assignment.id,
            readAt: null,
          }),
        );
        expect(mock.db.data.auditLog).toContainEqual(
          expect.objectContaining({
            action: 'created',
            entityType: 'assignment',
            entityId: assignment.id,
            actorId: signedInId,
          }),
        );
      }
    });

    it('assigns once when an employee is listed twice', async () => {
      const { api, mock } = setup();
      const ruth = userNamed(mock, 'Ruth');

      const result = await firstValueFrom(
        api.post('/assignments', {
          body: {
            questionnaireId: freshFor(mock, ruth).id,
            userIds: [ruth.id, ruth.id],
            dueAt: DUE_AT,
          },
        }),
      );

      expect(result.assignments).toHaveLength(1);
    });

    it('skips employees who already have an open assignment for it, and still answers 201', async () => {
      const { api, mock } = setup();
      const open = seededWithStatus(mock, true);
      const before = mock.db.data.assignments.length;

      const result = await firstValueFrom(
        api.post('/assignments', {
          body: { questionnaireId: open.questionnaireId, userIds: [open.userId], dueAt: DUE_AT },
        }),
      );

      expect(result).toEqual({
        assignments: [],
        skipped: [{ userId: open.userId, reason: 'open_assignment' }],
      });
      expect(mock.db.data.assignments).toHaveLength(before);
    });

    it('creates a new assignment after a pass and keeps the earlier one', async () => {
      const { api, mock } = setup();
      const passed = seededWithStatus(mock, false);

      const result = await firstValueFrom(
        api.post('/assignments', {
          body: {
            questionnaireId: passed.questionnaireId,
            userIds: [passed.userId],
            dueAt: DUE_AT,
          },
        }),
      );

      expect(result.assignments).toHaveLength(1);
      expect(result.assignments[0].id).not.toBe(passed.id);
      expect(statusesOf(mock, passed.userId, passed.questionnaireId).sort()).toEqual([
        'not_started',
        'passed',
      ]);
    });

    it('assigns a department to its active employees at this moment, skipping open ones', async () => {
      const { api, mock } = setup();
      const questionnaire = assignable(mock);
      const engineering = departmentNamed(mock, 'Engineering');
      const members = mock.db.data.users.filter((u) => u.departmentId === engineering.id);
      const active = members.filter((u) => u.status === 'active' && u.role === 'employee');
      expect(members.some((u) => u.status === 'inactive')).toBe(true);
      const withOpen = active.filter((u) =>
        statusesOf(mock, u.id, questionnaire.id).some((s) => s !== 'passed'),
      );

      const result = await firstValueFrom(
        api.post('/assignments', {
          body: { questionnaireId: questionnaire.id, departmentId: engineering.id, dueAt: DUE_AT },
        }),
      );

      expect(result.assignments.map((a) => a.userId).sort()).toEqual(
        active
          .filter((u) => !withOpen.includes(u))
          .map((u) => u.id)
          .sort(),
      );
      expect(result.skipped.map((s) => s.userId).sort()).toEqual(withOpen.map((u) => u.id).sort());
      expect(result.assignments.every((a) => a.departmentName === 'Engineering')).toBe(true);
    });

    it('refuses an inactive department', async () => {
      const { api, mock } = setup();
      const facilities = departmentNamed(mock, 'Facilities');

      const error = await failure(
        firstValueFrom(
          api.post('/assignments', {
            body: {
              questionnaireId: assignable(mock).id,
              departmentId: facilities.id,
              dueAt: DUE_AT,
            },
          }),
        ),
      );

      expect(error.status).toBe(422);
      expect(error.fieldErrors).toContainEqual(
        expect.objectContaining({ field: 'departmentId', message: 'Choose an active department.' }),
      );
    });

    it('refuses an inactive questionnaire and a questionnaire in an inactive topic', async () => {
      const { api, mock } = setup();
      const { questionnaires, topics } = mock.db.data;
      const inactive = questionnaires.find((q) => q.status === 'inactive');
      const inactiveTopic = topics.find((t) => t.status === 'inactive');
      expect(inactive).toBeDefined();
      expect(inactiveTopic).toBeDefined();
      // Put an active questionnaire into the inactive topic.
      const moved = assignable(mock);
      mock.db.update(() => (moved.topicId = inactiveTopic!.id));
      const ruth = userNamed(mock, 'Ruth');

      for (const questionnaire of [inactive!, moved]) {
        const error = await failure(
          firstValueFrom(
            api.post('/assignments', {
              body: { questionnaireId: questionnaire.id, userIds: [ruth.id], dueAt: DUE_AT },
            }),
          ),
        );
        expect(error.status).toBe(422);
        expect(error.fieldErrors.map((e) => e.field)).toEqual(['questionnaireId']);
      }
    });

    it('refuses administrators and inactive users', async () => {
      const { api, mock, signedInId } = setup();
      const sofia = userNamed(mock, 'Sofia');
      expect(sofia.status).toBe('inactive');

      const error = await failure(
        firstValueFrom(
          api.post('/assignments', {
            body: {
              questionnaireId: assignable(mock).id,
              userIds: [signedInId, sofia.id],
              dueAt: DUE_AT,
            },
          }),
        ),
      );

      expect(error.status).toBe(422);
      expect(error.fieldErrors).toEqual([
        expect.objectContaining({
          field: 'userIds[0]',
          message: 'Administrators cannot be assigned training.',
        }),
        expect.objectContaining({ field: 'userIds[1]', message: 'Choose an active employee.' }),
      ]);
    });

    it('needs exactly one of userIds and departmentId, and a deadline in the future', async () => {
      const { api, mock } = setup();
      const questionnaireId = assignable(mock).id;
      const ruth = userNamed(mock, 'Ruth');
      const sales = departmentNamed(mock, 'Sales');

      const neither = await failure(
        firstValueFrom(api.post('/assignments', { body: { questionnaireId, dueAt: DUE_AT } })),
      );
      expect(neither.fieldErrors.map((e) => e.field)).toEqual(['userIds']);

      const both = await failure(
        firstValueFrom(
          api.post('/assignments', {
            body: { questionnaireId, userIds: [ruth.id], departmentId: sales.id, dueAt: DUE_AT },
          }),
        ),
      );
      expect(both.fieldErrors.map((e) => e.field)).toEqual(['departmentId']);

      const empty = await failure(
        firstValueFrom(
          api.post('/assignments', { body: { questionnaireId, userIds: [], dueAt: DUE_AT } }),
        ),
      );
      expect(empty.fieldErrors.map((e) => e.field)).toEqual(['userIds']);

      const past = await failure(
        firstValueFrom(
          api.post('/assignments', {
            body: {
              questionnaireId,
              userIds: [ruth.id],
              dueAt: new Date(TEST_NOW.getTime() - 1000).toISOString(),
            },
          }),
        ),
      );
      expect(past.fieldErrors).toEqual([
        expect.objectContaining({ field: 'dueAt', message: 'Choose a deadline in the future.' }),
      ]);
    });

    it('is for administrators only', async () => {
      const { api, mock } = setup({ signedInAs: 'employee' });
      const before = mock.db.data.assignments.length;

      const error = await failure(
        firstValueFrom(
          api.post('/assignments', {
            body: {
              questionnaireId: assignable(mock).id,
              userIds: [userNamed(mock, 'Ruth').id],
              dueAt: DUE_AT,
            },
          }),
        ),
      );

      expect(error.isForbidden).toBe(true);
      expect(mock.db.data.assignments).toHaveLength(before);
    });
  });

  describe('list and read', () => {
    it('lists every assignment for administrators, newest first', async () => {
      const { api, mock } = setup();

      const result = await firstValueFrom(api.get('/assignments', { query: { pageSize: 100 } }));

      expect(result.page.totalItems).toBe(mock.db.data.assignments.length);
      const created = result.items.map((a) => a.createdAt);
      expect(created).toEqual([...created].sort().reverse());
      expect(result.items[0].employeeName).not.toBe('');
      expect(result.items[0].questionnaireTitle).not.toBe('');
    });

    it('lists only their own assignments for employees', async () => {
      const { api, mock, signedInId } = setup({ signedInAs: 'employee' });

      const result = await firstValueFrom(api.get('/assignments', { query: { pageSize: 100 } }));

      const own = mock.db.data.assignments.filter((a) => a.userId === signedInId);
      expect(own.length).toBeGreaterThan(0);
      expect(result.items.map((a) => a.id).sort()).toEqual(own.map((a) => a.id).sort());
    });

    it('filters by department and status, and searches names ignoring the kind of apostrophe', async () => {
      const { api, mock } = setup();
      const facilities = departmentNamed(mock, 'Facilities');
      const patrick = userNamed(mock, 'Patrick');

      const byDepartment = await firstValueFrom(
        api.get('/assignments', { query: { departmentId: facilities.id, pageSize: 100 } }),
      );
      expect(byDepartment.items.length).toBeGreaterThan(0);
      expect(byDepartment.items.every((a) => a.userId === patrick.id)).toBe(true);

      const searched = await firstValueFrom(
        api.get('/assignments', { query: { q: "o'neill", pageSize: 100 } }),
      );
      expect(searched.items.map((a) => a.id).sort()).toEqual(
        byDepartment.items.map((a) => a.id).sort(),
      );

      const overdue = await firstValueFrom(
        api.get('/assignments', { query: { status: 'overdue', pageSize: 100 } }),
      );
      expect(overdue.items.length).toBeGreaterThan(0);
      expect(overdue.items.every((a) => a.status === 'overdue')).toBe(true);
    });

    it("lists an inactive employee's whole history with the topic, and the status of each", async () => {
      const { api, mock } = setup();
      const sofia = userNamed(mock, 'Sofia');
      expect(sofia.status).toBe('inactive');
      const own = mock.db.data.assignments.filter((a) => a.userId === sofia.id);
      expect(own.length).toBeGreaterThan(0);
      // Deactivate the topic of one of her questionnaires after assigning.
      const questionnaire = mock.db.data.questionnaires.find(
        (q) => q.id === own[0].questionnaireId,
      )!;
      const topic = mock.db.data.topics.find((t) => t.id === questionnaire.topicId)!;
      mock.db.update((data) => {
        data.topics.find((t) => t.id === topic.id)!.status = 'inactive';
        data.questionnaires.find((q) => q.id === questionnaire.id)!.status = 'inactive';
      });

      const result = await firstValueFrom(
        api.get('/assignments', { query: { userId: sofia.id, pageSize: 100 } }),
      );

      expect(result.items.map((a) => a.id).sort()).toEqual(own.map((a) => a.id).sort());
      const deactivated = result.items.find((a) => a.questionnaireId === questionnaire.id)!;
      expect(deactivated).toMatchObject({
        questionnaireTitle: questionnaire.title,
        questionnaireStatus: 'inactive',
        topicId: topic.id,
        topicName: topic.name,
        topicStatus: 'inactive',
      });
      for (const item of result.items.filter((a) => a.questionnaireId !== questionnaire.id)) {
        const q = mock.db.data.questionnaires.find((x) => x.id === item.questionnaireId)!;
        const t = mock.db.data.topics.find((x) => x.id === q.topicId)!;
        expect(item).toMatchObject({
          questionnaireStatus: q.status,
          topicId: t.id,
          topicName: t.name,
          topicStatus: t.status,
        });
      }
    });

    it("answers 404 when an employee reads another employee's assignment", async () => {
      const { api, mock, signedInId } = setup({ signedInAs: 'employee' });
      const own = mock.db.data.assignments.find((a) => a.userId === signedInId)!;
      const other = mock.db.data.assignments.find((a) => a.userId !== signedInId)!;

      const read = await firstValueFrom(
        api.get('/assignments/{assignmentId}', { path: { assignmentId: own.id } }),
      );
      expect(read.id).toBe(own.id);

      const error = await failure(
        firstValueFrom(
          api.get('/assignments/{assignmentId}', { path: { assignmentId: other.id } }),
        ),
      );
      expect(error.isNotFound).toBe(true);
    });
  });
});
