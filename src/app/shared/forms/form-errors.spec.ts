import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { ApiError, ProblemType } from '../../core/api';
import { saveFailedMessage, serverFieldErrors } from './form-errors';

describe('form errors', () => {
  function fields() {
    return TestBed.runInInjectionContext(() => {
      const f = form(signal({ name: '', description: '' }));
      return { name: f.name, description: f.description };
    });
  }

  function apiError(status: number, type: string, errors: ApiError['fieldErrors'] = []) {
    return new ApiError({ type, title: 'x', status, detail: 'Detail.' }, errors);
  }

  it('maps the fields of a 422 and a 409 to the form', () => {
    const f = fields();
    const validation = apiError(422, ProblemType.validationFailed, [
      { location: 'body', field: 'description', code: 'too_long', message: 'Too long.' },
      { location: 'query', field: 'name', code: 'x', message: 'Not a body field.' },
    ]);
    const conflict = apiError(409, ProblemType.conflict, [
      { location: 'body', field: 'name', code: 'not_unique', message: 'Taken.' },
    ]);

    expect(serverFieldErrors(validation, f)).toEqual([
      { kind: 'server', message: 'Too long.', fieldTree: f.description },
    ]);
    expect(serverFieldErrors(conflict, f)).toEqual([
      { kind: 'server', message: 'Taken.', fieldTree: f.name },
    ]);
  });

  it('returns undefined when no field of the form is named', () => {
    const f = fields();

    expect(serverFieldErrors(apiError(500, ProblemType.internalError), f)).toBeUndefined();
    expect(
      serverFieldErrors(
        apiError(422, ProblemType.validationFailed, [
          { location: 'body', field: 'status', code: 'x', message: 'Unknown.' },
        ]),
        f,
      ),
    ).toBeUndefined();
    expect(serverFieldErrors(new Error('boom'), f)).toBeUndefined();
  });

  it('describes a failure without a field', () => {
    expect(saveFailedMessage(apiError(403, ProblemType.forbidden))).toBe(
      "You don't have permission to do this.",
    );
    expect(saveFailedMessage(apiError(404, ProblemType.notFound))).toContain('no longer exists');
    expect(saveFailedMessage(apiError(500, ProblemType.internalError))).toBe(
      'Something went wrong. Try again in a moment.',
    );
  });
});
