/*
 * Business rules the mock applies, mirrored from docs/developer-guide/business-rules.mdx.
 * Keep them in sync: when a rule changes there, change it here in the same pull request.
 */
import type { Assignment, AssignmentStatus, Attempt } from '../../app/core/api/api-schema.gen';
import type { AssignmentRecord } from '../db/mock-data';

/** Default passing score for new questionnaires, in percent. */
export const DEFAULT_PASSING_SCORE = 80;
/** Invite links are valid for 7 days. */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Password reset links are valid for 1 hour. */
export const PASSWORD_RESET_LIFETIME_MS = 60 * 60 * 1000;
/** Employees are reminded 3 days before a deadline. */
export const DEADLINE_REMINDER_MS = 3 * 24 * 60 * 60 * 1000;

/** Exact score in percent: correct answers / total questions × 100. */
export function scoreOf(correctCount: number, questionCount: number): number {
  return questionCount === 0 ? 0 : (correctCount / questionCount) * 100;
}

/** An attempt passes when its exact score is equal to or greater than the passing score. */
export function isPassing(score: number, passingScore: number): boolean {
  return score >= passingScore;
}

/** Fewest correct answers that pass, for a number of questions and a passing score. */
export function minimumCorrectToPass(questionCount: number, passingScore: number): number {
  return Math.ceil((passingScore * questionCount) / 100 - 1e-9);
}

/**
 * Status of an assignment, evaluated in this order:
 * 1. Passed if any attempt passed, even after the deadline.
 * 2. Overdue if the deadline has passed.
 * 3. Failed, In Progress or Not Started, based on the latest attempt.
 */
export function assignmentStatus(
  dueAt: string,
  attempts: readonly Attempt[],
  now: Date,
): AssignmentStatus {
  if (attempts.some((attempt) => attempt.passed === true)) return 'passed';
  if (Date.parse(dueAt) < now.getTime()) return 'overdue';
  const latest = latestAttempt(attempts);
  if (!latest) return 'not_started';
  return latest.status === 'in_progress' ? 'in_progress' : 'failed';
}

/** Builds the API's Assignment, with its derived fields, from the stored record and its attempts. */
export function toAssignment(
  record: AssignmentRecord,
  attempts: readonly Attempt[],
  now: Date,
): Assignment {
  const own = attempts.filter((attempt) => attempt.assignmentId === record.id);
  const submitted = own.filter((attempt) => attempt.status === 'submitted');
  const passing = submitted.find((attempt) => attempt.passed === true);
  return {
    ...record,
    status: assignmentStatus(record.dueAt, own, now),
    attemptCount: own.length,
    latestScore: latestAttempt(submitted)?.score ?? null,
    completedAt: passing?.submittedAt ?? null,
  };
}

function latestAttempt(attempts: readonly Attempt[]): Attempt | undefined {
  return attempts.reduce<Attempt | undefined>(
    (latest, attempt) =>
      !latest || attempt.attemptNumber > latest.attemptNumber ? attempt : latest,
    undefined,
  );
}
