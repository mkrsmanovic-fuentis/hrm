import type { SdBadgeTone } from '@specora-dev/ui-kit';
import type { AssignmentStatus } from '../../core/api';

/** What each assignment status is called on screen. */
export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  passed: 'Passed',
  failed: 'Failed',
  overdue: 'Overdue',
};

/** The badge tone of each assignment status, the same on every page. */
export const ASSIGNMENT_STATUS_VARIANTS: Record<AssignmentStatus, SdBadgeTone> = {
  not_started: 'neutral',
  in_progress: 'info',
  passed: 'success',
  failed: 'danger',
  overdue: 'warning',
};
