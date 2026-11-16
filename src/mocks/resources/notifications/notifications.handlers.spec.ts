import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../../app/core/api/api-client';
import { ApiError, ProblemType } from '../../../app/core/api/api-error';
import type { AssignmentRecord } from '../../db/mock-data';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../testing';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('notifications mock handlers', () => {
  function setup(options: TestMockApiOptions = { signedInAs: 'employee' }) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const employee = mock.db.data.users.find((u) => u.role === 'employee' && u.status === 'active');
    if (!employee) throw new Error('The seed has no active employee');
    return { api: TestBed.inject(ApiClient), mock, employee };
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

  /** Adds an open assignment for the user, with a deadline relative to TEST_NOW. */
  function addAssignment(
    mock: Mock,
    userId: string,
    { dueInMs, createdAgoMs = 10 * DAY }: { dueInMs: number; createdAgoMs?: number },
  ): AssignmentRecord {
    const data = mock.db.data;
    const questionnaire = data.questionnaires.find((q) => q.status === 'active');
    const admin = data.users.find((u) => u.role === 'administrator');
    if (!questionnaire || !admin) throw new Error('Seed is missing data');
    const assignment: AssignmentRecord = {
      id: crypto.randomUUID(),
      organizationId: data.organization.id,
      questionnaireId: questionnaire.id,
      userId,
      assignedById: admin.id,
      dueAt: new Date(TEST_NOW.getTime() + dueInMs).toISOString(),
      createdAt: new Date(TEST_NOW.getTime() - createdAgoMs).toISOString(),
      updatedAt: new Date(TEST_NOW.getTime() - createdAgoMs).toISOString(),
    };
    mock.db.update((d) => d.assignments.push(assignment));
    return assignment;
  }

  function remindersFor(mock: Mock, assignmentId: string) {
    return mock.db.data.notifications.filter(
      (n) => n.assignmentId === assignmentId && n.type === 'deadline_reminder',
    );
  }

  describe('list', () => {
    it("returns only the employee's own notifications, newest first, with title and deadline", async () => {
      const { api, mock, employee } = setup();
      const own = mock.db.data.notifications.filter((n) => n.userId === employee.id);

      const result = await firstValueFrom(api.get('/notifications', { query: { pageSize: 100 } }));

      expect(own.length).toBeGreaterThan(0);
      expect(result.page.totalItems).toBe(own.length);
      expect(result.items.every((n) => n.userId === employee.id)).toBe(true);
      const created = result.items.map((n) => n.createdAt);
      expect(created).toEqual([...created].sort().reverse());

      const first = result.items[0];
      const assignment = mock.db.data.assignments.find((a) => a.id === first.assignmentId);
      const questionnaire = mock.db.data.questionnaires.find(
        (q) => q.id === assignment?.questionnaireId,
      );
      expect(first.dueAt).toBe(assignment?.dueAt);
      expect(first.questionnaireTitle).toBe(questionnaire?.title);
    });

    it('returns only unread notifications with unread=true, so the total is the unread count', async () => {
      const { api, mock, employee } = setup();
      mock.db.update((data) => {
        const own = data.notifications.filter((n) => n.userId === employee.id);
        own.forEach((n, index) => (n.readAt = index === 0 ? null : TEST_NOW.toISOString()));
      });

      const result = await firstValueFrom(
        api.get('/notifications', { query: { unread: true, pageSize: 1 } }),
      );

      expect(result.page.totalItems).toBe(1);
      expect(result.items[0].readAt).toBeNull();
    });

    it('rejects an unread value that is not a boolean', async () => {
      const { mock } = setup();

      const response = await mock.fetch('/api/v1/notifications?unread=maybe');

      expect(response.status).toBe(422);
    });
  });

  describe('deadline reminders', () => {
    it('creates one reminder once the deadline is 3 days away or less, and never a second', async () => {
      const { api, mock, employee } = setup();
      const assignment = addAssignment(mock, employee.id, { dueInMs: 2 * DAY });

      const result = await firstValueFrom(api.get('/notifications', { query: { pageSize: 1 } }));
      await firstValueFrom(api.get('/notifications'));

      expect(remindersFor(mock, assignment.id)).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        type: 'deadline_reminder',
        assignmentId: assignment.id,
        readAt: null,
        createdAt: TEST_NOW.toISOString(),
      });
    });

    it('also reminds about an assignment created less than 3 days before its deadline', async () => {
      const { api, mock, employee } = setup();
      const assignment = addAssignment(mock, employee.id, { dueInMs: DAY, createdAgoMs: HOUR });

      await firstValueFrom(api.get('/notifications'));

      expect(remindersFor(mock, assignment.id)).toHaveLength(1);
    });

    it('does not remind before the last 3 days or after the deadline', async () => {
      const { api, mock, employee } = setup();
      const early = addAssignment(mock, employee.id, { dueInMs: 3 * DAY + HOUR });
      const late = addAssignment(mock, employee.id, { dueInMs: -HOUR });

      await firstValueFrom(api.get('/notifications'));

      expect(remindersFor(mock, early.id)).toHaveLength(0);
      expect(remindersFor(mock, late.id)).toHaveLength(0);
    });

    it('does not remind about a passed assignment', async () => {
      const { api, mock, employee } = setup();
      const assignment = addAssignment(mock, employee.id, { dueInMs: 2 * DAY });
      const attempt = mock.db.data.attempts[0];
      mock.db.update((data) =>
        data.attempts.push({
          ...attempt,
          id: crypto.randomUUID(),
          assignmentId: assignment.id,
          attemptNumber: 1,
          status: 'submitted',
          passed: true,
        }),
      );

      await firstValueFrom(api.get('/notifications'));

      expect(remindersFor(mock, assignment.id)).toHaveLength(0);
    });

    it("does not create reminders for other employees' assignments", async () => {
      const { api, mock, employee } = setup();
      const other = mock.db.data.users.find(
        (u) => u.role === 'employee' && u.status === 'active' && u.id !== employee.id,
      );
      if (!other) throw new Error('The seed needs two active employees');
      const assignment = addAssignment(mock, other.id, { dueInMs: 2 * DAY });

      await firstValueFrom(api.get('/notifications'));

      expect(remindersFor(mock, assignment.id)).toHaveLength(0);
    });
  });

  describe('mark as read', () => {
    it('marks one own notification as read', async () => {
      const { api, mock, employee } = setup();
      const notification = mock.db.data.notifications.find((n) => n.userId === employee.id);
      if (!notification) throw new Error('No own notification');
      mock.db.update(() => (notification.readAt = null));

      const result = await firstValueFrom(
        api.post('/notifications/{notificationId}/read', {
          path: { notificationId: notification.id },
        }),
      );

      expect(result.readAt).toBe(TEST_NOW.toISOString());
      expect(result.questionnaireTitle).toBeTruthy();
      expect(notification.readAt).toBe(TEST_NOW.toISOString());
    });

    it('keeps the first readAt when called again', async () => {
      const { api, mock, employee } = setup();
      const notification = mock.db.data.notifications.find((n) => n.userId === employee.id);
      if (!notification) throw new Error('No own notification');
      const firstRead = '2026-11-01T09:00:00.000Z';
      mock.db.update(() => (notification.readAt = firstRead));

      const result = await firstValueFrom(
        api.post('/notifications/{notificationId}/read', {
          path: { notificationId: notification.id },
        }),
      );

      expect(result.readAt).toBe(firstRead);
    });

    it("answers 404 for another employee's notification and for an unknown one", async () => {
      const { api, mock, employee } = setup();
      const others = mock.db.data.notifications.find((n) => n.userId !== employee.id);
      if (!others) throw new Error('No notification of another employee');
      mock.db.update(() => (others.readAt = null));

      for (const notificationId of [others.id, crypto.randomUUID()]) {
        const error = await failure(
          firstValueFrom(
            api.post('/notifications/{notificationId}/read', { path: { notificationId } }),
          ),
        );
        expect(error.status).toBe(404);
      }
      expect(others.readAt).toBeNull();
    });

    it("marks all own notifications as read and leaves other employees' alone", async () => {
      const { api, mock, employee } = setup();
      mock.db.update((data) => data.notifications.forEach((n) => (n.readAt = null)));

      await firstValueFrom(api.post('/notifications/read-all'));

      const own = mock.db.data.notifications.filter((n) => n.userId === employee.id);
      const others = mock.db.data.notifications.filter((n) => n.userId !== employee.id);
      expect(own.every((n) => n.readAt === TEST_NOW.toISOString())).toBe(true);
      expect(others.every((n) => n.readAt === null)).toBe(true);
    });
  });

  describe('access', () => {
    it('answers 403 to administrators on every notification endpoint', async () => {
      const { mock } = setup({ signedInAs: 'administrator' });
      const notification = mock.db.data.notifications[0];
      const before = mock.db.data.notifications.length;

      const responses = await Promise.all([
        mock.fetch('/api/v1/notifications'),
        mock.fetch(`/api/v1/notifications/${notification.id}/read`, { method: 'POST' }),
        mock.fetch('/api/v1/notifications/read-all', { method: 'POST' }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(403);
        expect((await response.json()).type).toBe(ProblemType.forbidden);
      }
      expect(mock.db.data.notifications).toHaveLength(before);
    });

    it('answers 401 without a session', async () => {
      const { mock } = setup({ signedInAs: null });

      const response = await mock.fetch('/api/v1/notifications');

      expect(response.status).toBe(401);
    });
  });
});
