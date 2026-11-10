import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { textRules } from './text-rules';

describe('textRules', () => {
  function check(value: string, rules: { required?: string; maxLength: number }) {
    return TestBed.runInInjectionContext(() => {
      const f = form(signal({ name: value }), (p) => textRules(p.name, rules));
      return f
        .name()
        .errors()
        .map((error) => error.message);
    });
  }

  it('checks the length of the trimmed text', () => {
    expect(check(`${'x'.repeat(5)}   `, { maxLength: 5 })).toEqual([]);
    expect(check(' xxxxxx ', { maxLength: 5 })).toEqual(['Use 5 characters or fewer.']);
  });

  it('treats only spaces as empty', () => {
    expect(check('   ', { required: 'Enter a name.', maxLength: 5 })).toEqual(['Enter a name.']);
    expect(check('', { maxLength: 5 })).toEqual([]);
  });
});
