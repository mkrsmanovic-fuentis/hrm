import type { NotificationRecord, UserRecord } from '../../db/mock-data';
import type { MockDb } from '../../db/mock-db';
import { needsDeadlineReminder, toNotification } from '../../rules/notification-rules';
import { requireOwnRecord, requireRole } from '../../support/access';
import { route } from '../../support/mock-route';

/**
 * Mock handlers for the Notifications tag in the spec. Employees only, and only their own
 * notifications; administrators get `403` (see the access matrix in
 * docs/developer-guide/business-rules.mdx). Notifications are not audit-logged.
 */
export const notificationRoutes = [
  route.get('/notifications', (ctx) => {
    const employee = requireRole(ctx, 'employee');
    const { db, query, page, ok, validationFailed, now } = ctx;
    const pagination = query.pagination();
    const unread = query.oneOf('unread', ['true', 'false'] as const, 'false') === 'true';
    if (query.errors.length > 0) return validationFailed(query.errors);

    // The real backend sends reminders from a daily job; the mock catches up when they are read.
    createDueReminders(db, employee, now);

    const notifications = db.data.notifications
      .filter((n) => n.userId === employee.id && (!unread || n.readAt === null))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map((n) => toNotification(n, db.data.assignments, db.data.questionnaires));
    return ok(page(notifications, pagination));
  }),

  route.post('/notifications/{notificationId}/read', (ctx) => {
    requireRole(ctx, 'employee');
    const { db, params, now, ok } = ctx;
    const notification = requireOwnRecord(
      ctx,
      db.data.notifications.find((n) => n.id === params.notificationId),
      (n) => n.userId,
      `Notification ${params.notificationId} was not found.`,
    );
    const read = db.update(() => {
      // Idempotent: a notification that is read already keeps its first readAt.
      if (notification.readAt === null) markRead(notification, now);
      return notification;
    });
    return ok(toNotification(read, db.data.assignments, db.data.questionnaires));
  }),

  route.post('/notifications/read-all', (ctx) => {
    const employee = requireRole(ctx, 'employee');
    const { db, now, noContent } = ctx;
    db.update((data) => {
      data.notifications
        .filter((n) => n.userId === employee.id && n.readAt === null)
        .forEach((n) => markRead(n, now));
    });
    return noContent();
  }),
];

function markRead(notification: NotificationRecord, now: Date): void {
  notification.readAt = now.toISOString();
  notification.updatedAt = now.toISOString();
}

/** Adds the deadline reminders the employee is due now, at most one per assignment. */
function createDueReminders(db: MockDb, employee: UserRecord, now: Date): void {
  const { assignments, attempts, notifications } = db.data;
  const due = assignments.filter(
    (a) =>
      a.userId === employee.id && needsDeadlineReminder(a, employee, attempts, notifications, now),
  );
  if (due.length === 0) return;
  db.update((data) => {
    const at = now.toISOString();
    for (const assignment of due) {
      data.notifications.push({
        id: crypto.randomUUID(),
        organizationId: data.organization.id,
        userId: employee.id,
        type: 'deadline_reminder',
        assignmentId: assignment.id,
        readAt: null,
        createdAt: at,
        updatedAt: at,
      });
    }
  });
}
