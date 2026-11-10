import type { FieldError } from '../../app/core/api/api-schema.gen';
import { MockProblem } from './problem';

/**
 * Reads and validates a JSON request body the way the spec describes it, like `QueryReader` does
 * for query parameters. Collects every problem instead of stopping at the first, so the 422
 * response lists them all.
 *
 * - A body that is not a JSON object answers `400`.
 * - Fields the spec does not list are rejected (`additionalProperties: false`).
 * - Text is trimmed before it is checked.
 *
 * @example
 * const body = new BodyReader(await ctx.json(), ['name', 'description']);
 * const name = body.text('name', { required: true, maxLength: 100 });
 * const description = body.nullableText('description', { maxLength: 500 });
 * if (body.errors.length > 0) return ctx.validationFailed(body.errors);
 */
export class BodyReader {
  readonly errors: FieldError[] = [];
  private readonly body: Record<string, unknown>;

  /**
   * @param prefix Put in front of every field name in `errors`, for an object nested in the body,
   *   for example `questions[2].`. Check that the nested value is an object with `isObject()`
   *   first; only the body itself answers `400` when it is not.
   */
  constructor(
    body: unknown,
    allowedFields: readonly string[],
    private readonly prefix = '',
  ) {
    if (!isObject(body)) {
      throw new MockProblem(400, 'The request body must be a JSON object.');
    }
    this.body = body;
    for (const field of Object.keys(this.body)) {
      if (!allowedFields.includes(field)) this.fail(field, 'invalid_value', 'Unknown field.');
    }
  }

  /** Whether the field was sent, even as `null`. */
  has(name: string): boolean {
    return Object.hasOwn(this.body, name);
  }

  /**
   * Text, trimmed. Returns `undefined` when the field is missing or invalid. With `required`, a
   * missing or empty value is an error; without it, an empty value is too, when the field is sent.
   */
  text(name: string, rules: { required?: boolean; maxLength: number }): string | undefined {
    if (!this.has(name)) {
      if (rules.required) this.fail(name, 'required', 'Required.');
      return undefined;
    }
    const raw = this.body[name];
    if (typeof raw !== 'string') {
      this.fail(name, 'invalid_type', 'Must be text.');
      return undefined;
    }
    const value = raw.trim();
    if (value === '') {
      this.fail(name, 'required', 'Required.');
      return undefined;
    }
    if (value.length > rules.maxLength) {
      this.fail(name, 'too_long', `Must be ${rules.maxLength} characters or fewer.`);
      return undefined;
    }
    return value;
  }

  /**
   * Optional text, trimmed; empty text becomes `null`. Returns `undefined` when the field is
   * missing or invalid, so the caller can tell "not sent" from "cleared".
   */
  nullableText(name: string, rules: { maxLength: number }): string | null | undefined {
    if (!this.has(name)) return undefined;
    const raw = this.body[name];
    if (raw === null) return null;
    if (typeof raw !== 'string') {
      this.fail(name, 'invalid_type', 'Must be text or null.');
      return undefined;
    }
    const value = raw.trim();
    if (value.length > rules.maxLength) {
      this.fail(name, 'too_long', `Must be ${rules.maxLength} characters or fewer.`);
      return undefined;
    }
    return value === '' ? null : value;
  }

  /**
   * A whole number within `min` and `max`. Returns `undefined` when the field is missing or
   * invalid. With `required`, a missing value is an error. `null` is invalid; use
   * `nullableInteger()` for fields that can be cleared.
   */
  integer(
    name: string,
    rules: { required?: boolean; min: number; max: number },
  ): number | undefined {
    if (!this.has(name)) {
      if (rules.required) this.fail(name, 'required', 'Required.');
      return undefined;
    }
    const raw = this.body[name];
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      this.fail(name, 'invalid_type', 'Must be a whole number.');
      return undefined;
    }
    if (raw < rules.min || raw > rules.max) {
      this.fail(name, 'out_of_range', `Must be between ${rules.min} and ${rules.max}.`);
      return undefined;
    }
    return raw;
  }

  /**
   * A whole number within `min` and `max`, or `null`. Returns `undefined` when the field is
   * missing or invalid, so the caller can tell "not sent" from "cleared".
   */
  nullableInteger(name: string, rules: { min: number; max: number }): number | null | undefined {
    if (this.has(name) && this.body[name] === null) return null;
    return this.integer(name, rules);
  }

  /**
   * An email address, trimmed, checked like `text()` and then with `isValid`. Returns `undefined`
   * when the field is missing or invalid.
   */
  email(
    name: string,
    rules: { required?: boolean; maxLength: number; isValid: (value: string) => boolean },
  ): string | undefined {
    const value = this.text(name, rules);
    if (value === undefined) return undefined;
    if (!rules.isValid(value)) {
      this.fail(name, 'invalid_format', 'Must be an email address.');
      return undefined;
    }
    return value;
  }

  /**
   * A reference to another record: an ID, or `null` for none. Returns `undefined` when the field
   * is missing or invalid. Whether the record exists is the handler's check.
   */
  nullableId(name: string): string | null | undefined {
    if (!this.has(name)) return undefined;
    const raw = this.body[name];
    if (raw === null) return null;
    if (typeof raw !== 'string' || raw.trim() === '') {
      this.fail(name, 'invalid_type', 'Must be an ID or null.');
      return undefined;
    }
    return raw.trim();
  }

  /** Records a problem with a field the handler checked itself, for example a missing record. */
  invalid(name: string, message: string): void {
    this.fail(name, 'invalid_value', message);
  }

  /** One of a fixed set of values. Returns `undefined` when missing or invalid. */
  oneOf<T extends string>(
    name: string,
    allowed: readonly T[],
    rules: { required?: boolean } = {},
  ): T | undefined {
    if (!this.has(name)) {
      if (rules.required) this.fail(name, 'required', 'Required.');
      return undefined;
    }
    const raw = this.body[name];
    if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
      this.fail(name, 'invalid_value', `Must be one of: ${allowed.join(', ')}.`);
      return undefined;
    }
    return raw as T;
  }

  /**
   * One of a fixed set of values, or `null`. Returns `undefined` when the field is missing or
   * invalid, so the caller can tell "not sent" from "cleared".
   */
  nullableOneOf<T extends string>(name: string, allowed: readonly T[]): T | null | undefined {
    if (this.has(name) && this.body[name] === null) return null;
    return this.oneOf(name, allowed);
  }

  /** `true` or `false`. Returns `undefined` when missing or invalid. */
  boolean(name: string, rules: { required?: boolean } = {}): boolean | undefined {
    if (!this.has(name)) {
      if (rules.required) this.fail(name, 'required', 'Required.');
      return undefined;
    }
    const raw = this.body[name];
    if (typeof raw !== 'boolean') {
      this.fail(name, 'invalid_type', 'Must be true or false.');
      return undefined;
    }
    return raw;
  }

  /**
   * A list, for nested items that the caller reads one by one. Returns `undefined` when missing
   * or not a list. With `required`, a missing value is an error.
   */
  array(name: string, rules: { required?: boolean } = {}): unknown[] | undefined {
    if (!this.has(name)) {
      if (rules.required) this.fail(name, 'required', 'Required.');
      return undefined;
    }
    const raw = this.body[name];
    if (!Array.isArray(raw)) {
      this.fail(name, 'invalid_type', 'Must be a list.');
      return undefined;
    }
    return raw;
  }

  /** Adds an error, with the reader's prefix in front of the field name. */
  private fail(field: string, code: string, message: string): void {
    this.errors.push({ location: 'body', field: `${this.prefix}${field}`, code, message });
  }
}

/** Whether a value is a JSON object: not `null`, not a list. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A `409` for a unique field that another record already uses. The problem's `errors` names the
 * field with code `not_unique`, so the form can show `message` next to it.
 *
 * @example
 * if (taken) throw notUnique('name', 'A department with this name already exists.', `A department named ${name} already exists.`);
 */
export function notUnique(field: string, message: string, detail: string): MockProblem {
  return new MockProblem(409, detail, [{ location: 'body', field, code: 'not_unique', message }]);
}
