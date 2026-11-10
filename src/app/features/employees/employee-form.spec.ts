import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { SdSelectOption } from '@specora-dev/ui-kit';
import { toDepartment } from '../../../mocks/rules/department-rules';
import { toUser } from '../../../mocks/rules/user-rules';
import { createTestMockApi, TEST_NOW } from '../../../mocks/testing';
import type { User } from '../../core/api';
import { EmployeeForm } from './employee-form';

describe('Employee form', () => {
  /** Opens the form for the user with this first name, or a new user for null. */
  async function render(firstName: string | null) {
    const mock = createTestMockApi();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const session = mock.db.data.sessions.find((s) => s.token === mock.token);
    const record = mock.db.data.users.find((u) => u.firstName === firstName);
    const fixture = TestBed.createComponent(EmployeeForm);
    if (record) fixture.componentRef.setInput('user', toUser(record, mock.db.data, TEST_NOW));
    fixture.componentRef.setInput(
      'departments',
      mock.db.data.departments.map((d) => toDepartment(d, mock.db.data.users)),
    );
    fixture.componentRef.setInput('currentUserId', session?.userId ?? null);
    const saved: User[] = [];
    fixture.componentInstance.saved.subscribe((u) => saved.push(u));
    await fixture.whenStable();

    const component = fixture.componentInstance as unknown as {
      departmentOptions: () => SdSelectOption<string>[];
      f: { role: () => { disabled: () => boolean } };
      saving: () => boolean;
    };
    const input = (label: string) =>
      [...document.querySelectorAll('sd-drawer sd-field')]
        .find((f) => f.textContent?.includes(label))
        ?.querySelector<HTMLInputElement>('input') ?? null;
    const type = async (label: string, value: string) => {
      const element = input(label)!;
      element.value = value;
      element.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const submit = async () => {
      document.querySelector<HTMLButtonElement>('sd-drawer button[type=submit]')!.click();
      await fixture.whenStable();
      await vi.waitFor(() => expect(component.saving()).toBe(false));
      await fixture.whenStable();
    };
    return { fixture, mock, record, saved, component, input, type, submit };
  }

  it('starts with the user being edited', async () => {
    const { input } = await render('Oliver');

    expect(document.querySelector('sd-drawer')?.textContent).toContain('Edit employee');
    expect(input('First name')?.value).toBe('Oliver');
    expect(input('Last name')?.value).toBe('Grant');
    expect(input('Email')?.value).toBe('oliver.grant@brightwater.example');
  });

  it('offers no department and the active departments only', async () => {
    const { component, mock } = await render(null);
    const options = component.departmentOptions();

    expect(options[0]).toEqual({ value: '', label: 'No department' });
    expect(options.map((o) => o.label)).not.toContain('Facilities');
    expect(options).toHaveLength(
      1 + mock.db.data.departments.filter((d) => d.status === 'active').length,
    );
  });

  it('keeps an inactive department the user is already in, marked inactive', async () => {
    const { component, submit, type, saved, record } = await render('Patrick');

    const facilities = component.departmentOptions().find((o) => o.label === 'Facilities');
    expect(facilities?.description).toContain('Inactive');

    await type('Last name', 'O’Neil');
    await submit();

    expect(saved).toEqual([
      expect.objectContaining({ id: record?.id, departmentId: record?.departmentId }),
    ]);
  });

  it('checks lengths after trimming, as the API does', async () => {
    const { type, submit, saved, input } = await render('Oliver');
    const longest = 'x'.repeat(100);

    await type('Last name', `${longest} `);
    await submit();
    expect(saved).toEqual([expect.objectContaining({ lastName: longest })]);
    expect(input('Last name')).toBeDefined();
  });

  it('rejects a name longer than the limit after trimming', async () => {
    const { type, submit, saved } = await render('Oliver');

    await type('Last name', ` ${'x'.repeat(101)} `);
    await submit();

    expect(saved).toEqual([]);
    expect(document.querySelector('sd-drawer')?.textContent).toContain(
      'Use 100 characters or fewer.',
    );
  });

  it('sends only the changed fields of an edit', async () => {
    const { type, submit, mock, record } = await render('Oliver');
    const logSize = mock.db.data.auditLog.length;

    await type('First name', 'Olly');
    await submit();

    expect(mock.db.data.auditLog.slice(logSize)).toEqual([
      expect.objectContaining({
        action: 'updated',
        entityId: record?.id,
        changes: [{ field: 'firstName', oldValue: 'Oliver', newValue: 'Olly' }],
      }),
    ]);
  });

  it('locks the role on the signed-in administrator’s own record', async () => {
    const self = await render('Maja');

    expect(self.component.f.role().disabled()).toBe(true);
    expect(document.querySelector('sd-drawer')?.textContent).toContain(
      'You cannot change your own role.',
    );
  });

  it('lets the role of other users change', async () => {
    const other = await render('Daniel');

    expect(other.component.f.role().disabled()).toBe(false);
  });
});
