import type { SdBadgeTone } from '@specora-dev/ui-kit';
import type { Assignment, AssignmentStatus } from '../../core/api';

/**
 * How an assignment's status is shown everywhere: one label and one badge tone per status. See
 * "Assignment status" in the business rules for how the status is derived.
 */
export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  passed: 'Passed',
  failed: 'Failed',
  overdue: 'Overdue',
};

/**
 * Badge tone per status. Overdue is the only status in the danger tone, so missed deadlines stand
 * out. A failed attempt can still be retried, so it is a warning.
 */
export const ASSIGNMENT_STATUS_VARIANTS: Record<AssignmentStatus, SdBadgeTone> = {
  not_started: 'neutral',
  in_progress: 'info',
  passed: 'success',
  failed: 'warning',
  overdue: 'danger',
};

/** The statuses in the order a status filter lists them. */
export const ASSIGNMENT_STATUS_ORDER: readonly AssignmentStatus[] = [
  'not_started',
  'in_progress',
  'failed',
  'overdue',
  'passed',
];

/** Whether the assignment was passed after its deadline. It still counts as passed. */
export function isPassedLate(assignment: Pick<Assignment, 'completedAt' | 'dueAt'>): boolean {
  return (
    assignment.completedAt !== null &&
    Date.parse(assignment.completedAt) > Date.parse(assignment.dueAt)
  );
}
