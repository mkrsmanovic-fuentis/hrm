import { HttpErrorResponse } from '@angular/common/http';
import type { ActivationProblem, FieldError, Problem } from './api-schema.gen';

/** Problem `type` values the API uses. See the API reference overview. */
export const ProblemType = {
  badRequest: '/problems/bad-request',
  unauthenticated: '/problems/unauthenticated',
  /** Sign-in only: the email and password do not match an account that can sign in. */
  invalidCredentials: '/problems/invalid-credentials',
  /** Sign-in only: the password is right, but the account is deactivated. */
  accountInactive: '/problems/account-inactive',
  forbidden: '/problems/forbidden',
  /** Invite and reset links: unknown, replaced by a newer link, or of a deactivated user. */
  linkNotFound: '/problems/link-not-found',
  /** Invite and reset links: the link has expired. */
  linkExpired: '/problems/link-expired',
  /** Invite and reset links: the link was used already. */
  linkUsed: '/problems/link-used',
  notFound: '/problems/not-found',
  conflict: '/problems/conflict',
  /**
   * Saving questions only: the save was based on an older version, or attempts started on it
   * since it was loaded. Reload the version and save again.
   */
  versionConflict: '/problems/version-conflict',
  validationFailed: '/problems/validation-failed',
  internalError: '/problems/internal-error',
  /** Client-side only: the request never reached the API. */
  networkError: '/problems/network-error',
} as const;

/**
 * The error every ApiClient call fails with. It wraps the RFC 9457 problem the API returned,
 * or a synthesized one when the response was not a problem (for example a network failure).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Problem;
  /**
   * Field-level errors from the problem's `errors`: invalid fields on a `422`, and the duplicate
   * field (code `not_unique`) on a `409`. Empty otherwise.
   */
  readonly fieldErrors: readonly FieldError[];

  constructor(problem: Problem, fieldErrors: readonly FieldError[] = []) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.problem = problem;
    this.fieldErrors = fieldErrors;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  /** A save of questions based on an older state: see `ProblemType.versionConflict`. */
  get isVersionConflict(): boolean {
    return this.isConflict && this.problem.type === ProblemType.versionConflict;
  }

  get isValidation(): boolean {
    return this.status === 422;
  }

  /**
   * Why a questionnaire could not be activated: the `activationProblems` of a `409` from
   * `PATCH /questionnaires/{questionnaireId}`. Empty for every other error.
   */
  get activationProblems(): readonly ActivationProblem[] {
    const problems = (this.problem as Problem & { activationProblems?: unknown })
      .activationProblems;
    return this.isConflict && Array.isArray(problems) ? (problems as ActivationProblem[]) : [];
  }

  static fromHttpError(error: HttpErrorResponse): ApiError {
    const body: unknown = error.error;
    if (isProblem(body)) {
      const fieldErrors = Array.isArray(body['errors']) ? (body['errors'] as FieldError[]) : [];
      return new ApiError(body, fieldErrors);
    }
    if (error.status === 0) {
      return new ApiError({
        type: ProblemType.networkError,
        title: 'Network error',
        status: 0,
        detail: 'The server could not be reached. Check your connection and try again.',
      });
    }
    return new ApiError({
      type: 'about:blank',
      title: error.statusText || 'Request failed',
      status: error.status,
    });
  }
}

function isProblem(value: unknown): value is Problem & Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Problem).type === 'string' &&
    typeof (value as Problem).title === 'string' &&
    typeof (value as Problem).status === 'number'
  );
}
