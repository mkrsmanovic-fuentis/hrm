import { HttpResponse } from 'msw';
import { ProblemType } from '../../app/core/api/api-error';
import type { FieldError, Problem } from '../../app/core/api/api-schema.gen';

const titles: Record<number, [type: string, title: string, detail: string]> = {
  400: [ProblemType.badRequest, 'Bad request', 'The request could not be read.'],
  401: [ProblemType.unauthenticated, 'Not signed in', 'Sign in to continue.'],
  403: [ProblemType.forbidden, 'Access denied', 'You do not have permission to do this.'],
  404: [ProblemType.notFound, 'Not found', 'The requested resource was not found.'],
  409: [ProblemType.conflict, 'Conflict', 'The request conflicts with the current state.'],
  422: [ProblemType.validationFailed, 'Validation failed', 'One or more fields are invalid.'],
  500: [ProblemType.internalError, 'Something went wrong', 'Try again later.'],
};

/** Builds the RFC 9457 problem body for a status, using the spec's type and title. */
export function problemBody(status: number, detail?: string, instance?: string): Problem {
  const [type, title, defaultDetail] = titles[status] ?? ['about:blank', `HTTP ${status}`, ''];
  return {
    type,
    title,
    status,
    detail: detail ?? (defaultDetail || undefined),
    ...(instance ? { instance } : {}),
  };
}

/** An `application/problem+json` response, as described in the spec's shared responses. */
export function problemResponse(
  status: number,
  detail?: string,
  extra: { instance?: string; errors?: FieldError[] } = {},
): Response {
  const body = {
    ...problemBody(status, detail, extra.instance),
    ...(extra.errors ? { errors: extra.errors } : {}),
  };
  return HttpResponse.json(body, {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

/** A 422 validation problem with a field-level `errors` list. */
export function validationProblem(errors: FieldError[], instance?: string): Response {
  const detail =
    errors.length === 1 ? '1 field is invalid.' : `${errors.length} fields are invalid.`;
  return problemResponse(422, detail, { instance, errors });
}

/**
 * Throw from a resolver to answer with a problem, for example from a helper deep in a handler.
 * The route wrapper turns it into a problem response.
 */
export class MockProblem extends Error {
  constructor(
    readonly status: number,
    readonly detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? `HTTP ${status}`);
  }
}
