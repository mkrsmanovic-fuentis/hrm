import type {
  AnswerOption,
  Assignment,
  Attempt,
  AttemptAnswer,
  AuditEntityType,
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

/**
 * Derived fields per audited record type: the API returns them, but they are never stored and
 * never listed in an audit entry's `changes`. `recordAudit()` rejects records that carry them.
 */
export const DERIVED_FIELDS = {
  user: ['assignedTrainingCount', 'completedTrainingCount', 'invitationStatus'],
  department: ['employeeCount'],
  topic: ['questionnaireCount'],
  questionnaire: ['questionCount'],
  assignment: ['status', 'attemptCount', 'latestScore', 'completedAt'],
} as const satisfies Record<AuditEntityType, readonly string[]>;

type Derived<E extends AuditEntityType> = (typeof DERIVED_FIELDS)[E][number];

export type UserRecord = Omit<User, Derived<'user'>>;
export type DepartmentRecord = Omit<Department, Derived<'department'>>;
export type TopicRecord = Omit<Topic, Derived<'topic'>>;
export type QuestionnaireRecord = Omit<Questionnaire, Derived<'questionnaire'>>;
export type QuestionnaireVersionRecord = Omit<QuestionnaireVersion, 'questions'>;
export type QuestionRecord = Omit<Question, 'answerOptions'>;
export type AssignmentRecord = Omit<Assignment, Derived<'assignment'>>;

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

/** What an account link lets its holder do: set a first password, or reset a forgotten one. */
export type AccountLinkPurpose = 'invitation' | 'password_reset';

/**
 * An invite or password reset link. The token is the secret in the link's URL. The real backend
 * stores only a hash of it; the mock keeps it as it is, like session tokens.
 */
export interface AccountLinkRecord {
  token: string;
  userId: string;
  purpose: AccountLinkPurpose;
  createdAt: string;
  expiresAt: string;
  /** When the link was used to set a password. A used link never works again. */
  usedAt: string | null;
}

/**
 * A password the user set through a link. Mock only: a SHA-256 hash, so the browser's storage
 * never holds the password itself. The real backend uses a slow password hash such as Argon2id.
 * Users without one sign in with the demo password.
 */
export interface CredentialRecord {
  userId: string;
  passwordHash: string;
}

/** Everything the mock API knows: one table per entity in the data model. */
export interface MockData {
  /** The current organization. The MVP has exactly one. */
  organization: Organization;
  roles: Role[];
  users: UserRecord[];
  departments: DepartmentRecord[];
  topics: TopicRecord[];
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
  /**
   * Invite and password reset links. Empty in the seed: seeded invites have no link the demo can
   * show, so an administrator sends the invite again to get one.
   */
  accountLinks: AccountLinkRecord[];
  /** Passwords users set through a link. Empty in the seed: seeded users use the demo password. */
  credentials: CredentialRecord[];
}
