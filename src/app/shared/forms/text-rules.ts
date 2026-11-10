import { type SchemaPath, validate } from '@angular/forms/signals';

/**
 * Rules for a text field, checked on the trimmed value, as the API checks it: the API removes
 * spaces around text before checking it. So 100 characters plus a trailing space pass a
 * 100-character limit, and only spaces count as empty.
 *
 * @example
 * form(model, (p) => {
 *   textRules(p.name, { required: 'Enter a name.', maxLength: 100 });
 *   textRules(p.description, { maxLength: 500 });
 * });
 */
export function textRules(
  path: SchemaPath<string>,
  rules: { required?: string; maxLength: number },
): void {
  validate(path, ({ value }) => {
    const text = value().trim();
    if (text === '') {
      return rules.required ? { kind: 'required', message: rules.required } : undefined;
    }
    return text.length > rules.maxLength
      ? { kind: 'maxLength', message: `Use ${rules.maxLength} characters or fewer.` }
      : undefined;
  });
}
