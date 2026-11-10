import type {
  AnswerOption,
  Assignment,
  Attempt,
  AttemptAnswer,
  AuditLogEntry,
  Department,
  Notification,
  Organization,
  Question,
  Questionnaire,
  QuestionnaireVersion,
  Role,
  Topic,
  User,
} from '../../app/core/api/api-schema.gen';

/*
 * Stored records use the API schemas from the spec. Where the API returns fields that are
 * derived (counts, statuses) or nested (questions in a version), the stored record leaves
 * them out and the handler builds them. See ../rules/ for the derivations.
 */

export type QuestionnaireRecord = Omit<Questionnaire, 'questionCount'>;
export type QuestionnaireVersionRecord = Omit<QuestionnaireVersion, 'questions'>;
export type QuestionRecord = Omit<Question, 'answerOptions'>;
export type AssignmentRecord = Omit<
  Assignment,
  'status' | 'attemptCount' | 'latestScore' | 'completedAt'
>;

/**
 * A signed-in session. The API returns it as `Session`, with the user nested; the stored record
 * keeps only the user's ID. See ../support/auth.ts.
 */
export interface SessionRecord {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

/** Everything the mock API knows: one table per entity in the data model. */
export interface MockData {
  /** The current organization. The MVP has exactly one. */
  organization: Organization;
  roles: Role[];
  users: User[];
  departments: Department[];
  topics: Topic[];
  questionnaires: QuestionnaireRecord[];
  questionnaireVersions: QuestionnaireVersionRecord[];
  questions: QuestionRecord[];
  answerOptions: AnswerOption[];
  assignments: AssignmentRecord[];
  attempts: Attempt[];
  attemptAnswers: AttemptAnswer[];
  notifications: Notification[];
  auditLog: AuditLogEntry[];
  /** Signed-in sessions. Empty in the seed; sign-in adds one, sign-out removes it. */
  sessions: SessionRecord[];
}
