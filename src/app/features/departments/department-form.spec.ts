import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import type { Department } from '../../core/api';
import { toDepartment } from '../../../mocks/rules/department-rules';
import { DepartmentForm } from './department-form';

describe('Department form', () => {
  async function render(name: string | null, options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const record = mock.db.data.departments.find((d) => d.name === name);
    const fixture = TestBed.createComponent(DepartmentForm);
    if (record)
      fixture.componentRef.setInput('department', toDepartment(record, mock.db.data.users));
    const saved: Department[] = [];
    let closed = 0;
    fixture.componentInstance.saved.subscribe((d) => saved.push(d));
    fixture.componentInstance.closed.subscribe(() => closed++);
    await fixture.whenStable();

    const field = (selector: string) =>
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`sd-drawer ${selector}`)!;
    const type = async (selector: string, value: string) => {
      field(selector).value = value;
      field(selector).dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const submit = async () => {
      document.querySelector<HTMLButtonElement>('sd-drawer button[type=submit]')!.click();
      await fixture.whenStable();
      // Done when the button is enabled again, or gone because the drawer closed.
      await vi.waitFor(() =>
        expect(
          document.querySelector('sd-drawer button[type=submit]')?.hasAttribute('disabled') ??
            false,
        ).toBe(false),
      );
      await vi.waitFor(() => expect(fixture.componentInstance['saving']()).toBe(false));
      await fixture.whenStable();
    };
    return { fixture, mock, record, saved, closed: () => closed, field, type, submit };
  }

  it('starts with the department being edited', async () => {
    const { field } = await render('Engineering');

    expect(document.querySelector('sd-drawer')?.textContent).toContain('Edit department');
    expect(field('input').value).toBe('Engineering');
    expect(field('textarea').value).toBe('Builds and runs the routing and tracking platform.');
  });

  it('clears the description when it is emptied', async () => {
    const { type, submit, saved, record, mock } = await render('Engineering');

    await type('textarea', '   ');
    await submit();

    expect(saved).toEqual([expect.objectContaining({ id: record?.id, description: null })]);
    expect(mock.db.data.departments.find((d) => d.id === record?.id)?.description).toBeNull();
  });

  it('checks the length of the fields before sending', async () => {
    const { type, submit, saved } = await render(null);

    await type('input', 'x'.repeat(101));
    await type('textarea', 'x'.repeat(501));
    await submit();

    const errors = [...document.querySelectorAll('sd-drawer sd-field')].map((f) => f.textContent);
    expect(errors[0]).toContain('Use 100 characters or fewer.');
    expect(errors[1]).toContain('Use 500 characters or fewer.');
    expect(saved).toEqual([]);
  });

  it('shows a failure without a field in a callout, and stays open', async () => {
    const { type, submit, saved, closed } = await render(null, { flags: { errorStatus: 500 } });

    await type('input', 'Legal');
    await submit();

    expect(document.querySelector('sd-drawer sd-callout')?.textContent).toContain(
      'Something went wrong. Try again in a moment.',
    );
    expect(saved).toEqual([]);
    expect(closed()).toBe(0);
  });
});
