import type { FieldTree, ReadonlyFieldTree, ValidationError } from '@angular/forms/signals';
import { ApiError } from '../../core/api';

/**
 * The error to show under a field: the first one, once the field is touched. `submit()` marks
 * every field touched, so a submit shows all errors. Pass the result to `sd-field`'s `error`.
 *
 * @example
 * <sd-field label="Name" [error]="visibleError(f.name)" required>
 */
export function visibleError<T>(field: FieldTree<T>): string | null {
  const state = field();
  if (!state.touched() || !state.invalid()) return null;
  return state.errors()[0]?.message ?? null;
}

/**
 * Turns a failed save into errors on the form's fields, for `submit()` to show: the invalid
 * fields of a `422`, and the duplicate field of a `409` (code `not_unique`). `fields` maps the
 * API's body field names to the form's fields.
 *
 * Returns `undefined` when the error names no field of the form, for example a `500` or a `403`.
 * Show those in the form's error callout instead.
 *
 * @example
 * await submit(this.f, async (form) => {
 *   try {
 *     await firstValueFrom(this.api.post('/departments', { body }));
 *   } catch (error) {
 *     const errors = serverFieldErrors(error, { name: form.name, description: form.description });
 *     if (errors) return errors;
 *     this.formError.set(saveFailedMessage(error));
 *   }
 *   return undefined;
 * });
 */
export function serverFieldErrors(
  error: unknown,
  fields: Readonly<Record<string, ReadonlyFieldTree<unknown>>>,
): ValidationError.WithOptionalFieldTree[] | undefined {
  if (!(error instanceof ApiError) || !(error.isValidation || error.isConflict)) return undefined;
  const errors = error.fieldErrors
    .filter(
      (fieldError) => fieldError.location === 'body' && Object.hasOwn(fields, fieldError.field),
    )
    .map((fieldError) => ({
      kind: 'server',
      message: fieldError.message,
      fieldTree: fields[fieldError.field],
    }));
  return errors.length > 0 ? errors : undefined;
}

/** A sentence for a save that failed without a field to show it on. */
export function saveFailedMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isForbidden) return "You don't have permission to do this.";
    if (error.isNotFound) return 'This record no longer exists. Reload the page.';
    if (error.isConflict && error.problem.detail) return error.problem.detail;
  }
  return 'Something went wrong. Try again in a moment.';
}
