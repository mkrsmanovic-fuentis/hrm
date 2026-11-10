import type { Questionnaire } from '../../core/api';

/** Labels for a questionnaire's status. */
export const STATUS_LABELS: Record<Questionnaire['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
};

/** "80%". */
export function passingScoreText(score: number): string {
  return `${score}%`;
}

/** "15 minutes", "1 minute" or "No time limit". */
export function timeLimitText(minutes: number | null): string {
  if (minutes === null) return 'No time limit';
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** "12 questions", "1 question" or "No questions". */
export function questionCountText(count: number): string {
  if (count === 0) return 'No questions';
  return count === 1 ? '1 question' : `${count} questions`;
}

/**
 * Whether the questionnaire passes the checks before activation, from the API's derived
 * `activationProblems`. The API has the last word: it answers `409` with the same list when a
 * check fails.
 */
export function canActivate(questionnaire: Pick<Questionnaire, 'activationProblems'>): boolean {
  return questionnaire.activationProblems.length === 0;
}

/** "1 problem" or "3 problems". */
export function problemCountText(count: number): string {
  return count === 1 ? '1 problem' : `${count} problems`;
}
