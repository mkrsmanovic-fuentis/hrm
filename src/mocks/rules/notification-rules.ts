/*
 * Notification rules the mock applies, mirrored from the "Notifications" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { Attempt, Notification } from '../../app/core/api/api-schema.gen';
import type {
  AssignmentRecord,
  NotificationRecord,
  QuestionnaireRecord,
  UserRecord,
} from '../db/mock-data';
import { DEADLINE_REMINDER_MS } from './training-rules';

/**
 * Whether an assignment is due a deadline reminder now: its deadline is 3 days away or less and
 * still in the future, it is not passed, its employee is active, and it has no reminder yet.
 * An assignment created less than 3 days before its deadline still gets one.
 */
export function needsDeadlineReminder(
  assignment: Pick<AssignmentRecord, 'id' | 'dueAt'>,
  user: Pick<UserRecord, 'status'>,
  attempts: readonly Pick<Attempt, 'assignmentId' | 'passed'>[],
  notifications: readonly Pick<NotificationRecord, 'assignmentId' | 'type'>[],
  now: Date,
): boolean {
  const dueMs = Date.parse(assignment.dueAt);
  const nowMs = now.getTime();
  if (dueMs <= nowMs || dueMs - nowMs > DEADLINE_REMINDER_MS) return false;
  if (user.status !== 'active') return false;
  if (attempts.some((a) => a.assignmentId === assignment.id && a.passed === true)) return false;
  return !notifications.some(
    (n) => n.assignmentId === assignment.id && n.type === 'deadline_reminder',
  );
}

/** Builds the API's Notification: the stored record plus its assignment's title and deadline. */
export function toNotification(
  record: NotificationRecord,
  assignments: readonly AssignmentRecord[],
  questionnaires: readonly QuestionnaireRecord[],
): Notification {
  const assignment = assignments.find((a) => a.id === record.assignmentId);
  if (!assignment) throw new Error(`Notification ${record.id} has no assignment.`);
  const questionnaire = questionnaires.find((q) => q.id === assignment.questionnaireId);
  if (!questionnaire) throw new Error(`Assignment ${assignment.id} has no questionnaire.`);
  return { ...record, questionnaireTitle: questionnaire.title, dueAt: assignment.dueAt };
}
