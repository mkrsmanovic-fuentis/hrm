/*
 * Rules for assigning training the mock applies, mirrored from the "Assigning training" section of
 * docs/developer-guide/business-rules.mdx. Keep them in sync.
 */
import type { AssignmentStatus } from '../../app/core/api/api-schema.gen';
import type { AssignmentRecord, MockData, QuestionnaireRecord, UserRecord } from '../db/mock-data';
import { assignmentStatus } from './training-rules';
import { fullName, searchKey } from './user-rules';

/** Longest `q` accepted by `GET /assignments`: a questionnaire title's maximum length. */
export const ASSIGNMENT_SEARCH_MAX_LENGTH = 200;

/** Only active users with the role `employee` can be assigned training. Administrators cannot. */
export function canBeAssigned(user: Pick<UserRecord, 'role' | 'status'>): boolean {
  return user.role === 'employee' && user.status === 'active';
}

/** An open assignment is one that is not passed: not started, in progress, failed or overdue. */
export function isOpen(status: AssignmentStatus): boolean {
  return status !== 'passed';
}

/**
 * Whether the employee already has an open assignment for the questionnaire. Such employees are
 * skipped when it is assigned again. After a pass, a new assignment can be created.
 */
export function hasOpenAssignment(
  userId: string,
  questionnaireId: string,
  data: Pick<MockData, 'assignments' | 'attempts'>,
  now: Date,
): boolean {
  return data.assignments.some(
    (assignment: AssignmentRecord) =>
      assignment.userId === userId &&
      assignment.questionnaireId === questionnaireId &&
      isOpen(
        assignmentStatus(
          assignment.dueAt,
          data.attempts.filter((attempt) => attempt.assignmentId === assignment.id),
          now,
        ),
      ),
  );
}

/**
 * Why the questionnaire cannot be assigned, or null when it can: it must be active, and its topic
 * active.
 */
export function notAssignableReason(
  questionnaire: Pick<QuestionnaireRecord, 'status' | 'topicId'>,
  data: Pick<MockData, 'topics'>,
): string | null {
  if (questionnaire.status !== 'active') return 'Choose an active questionnaire.';
  const topic = data.topics.find((candidate) => candidate.id === questionnaire.topicId);
  if (!topic || topic.status !== 'active') {
    return 'This questionnaire is in an inactive topic. Choose another questionnaire.';
  }
  return null;
}

/** `q` matches the employee's full name or the questionnaire's title. */
export function matchesAssignmentSearch(
  employee: Pick<UserRecord, 'firstName' | 'lastName'> | undefined,
  questionnaire: Pick<QuestionnaireRecord, 'title'> | undefined,
  query: string,
): boolean {
  const key = searchKey(query);
  return (
    (employee !== undefined && searchKey(fullName(employee)).includes(key)) ||
    (questionnaire !== undefined && searchKey(questionnaire.title).includes(key))
  );
}
