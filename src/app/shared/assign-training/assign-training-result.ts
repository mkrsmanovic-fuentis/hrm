import type { SkipReason, User } from '../../core/api';
import type { ToastOptions } from '../../core/toast';

/** An employee who got no new assignment, with their name for the page to show. */
export interface SkippedEmployee {
  userId: string;
  name: string;
  reason: SkipReason;
}

/** What assigning a questionnaire did, as the "Assign training" drawer emits it. */
export interface AssignTrainingResult {
  questionnaireTitle: string;
  /** How many assignments were created. 0 when every employee was skipped. */
  createdCount: number;
  skipped: SkippedEmployee[];
}

/** Why an employee was skipped, as a sentence. */
export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  open_assignment: 'Already has an open assignment for this questionnaire.',
};

export const fullName = (user: Pick<User, 'firstName' | 'lastName'>) =>
  `${user.firstName} ${user.lastName}`;

const assignmentsText = (count: number) => `${count} ${count === 1 ? 'assignment' : 'assignments'}`;
const employeesText = (count: number) => `${count} ${count === 1 ? 'employee' : 'employees'}`;

/**
 * The toast after assigning: how many assignments were created, and how many employees were
 * skipped. The page lists the skipped employees by name in `<app-assign-result>`.
 */
export function assignResultToast(result: AssignTrainingResult): {
  message: string;
  options: ToastOptions;
} {
  const { createdCount, skipped, questionnaireTitle } = result;
  const skippedText =
    skipped.length > 0
      ? ` ${employeesText(skipped.length)} skipped: see the list on the page.`
      : '';
  if (createdCount === 0) {
    return {
      message:
        skipped.length > 0
          ? `Every chosen employee already has an open assignment for ${questionnaireTitle}.`
          : 'The department has no active employees.',
      options: { tone: 'warning', heading: 'No assignments created' },
    };
  }
  return {
    message: `${questionnaireTitle} is assigned.${skippedText}`,
    options: { tone: 'success', heading: `${assignmentsText(createdCount)} created` },
  };
}
