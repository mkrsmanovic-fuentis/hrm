import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { SdList } from '@specora-dev/ui-kit';
import { toUser } from '../../../mocks/rules/user-rules';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../../mocks/testing';
import type { User } from '../../core/api';
import { AuthService, DEMO_ACCOUNTS } from '../../core/auth';
import { ToastService } from '../../core/toast';
import { EmployeeList } from './employee-list';

describe('Employees page', () => {
  async function render(options: TestMockApiOptions = {}, { demo = true } = {}) {
    const mock = createTestMockApi(options);
    const session = mock.db.data.sessions.find((s) => s.token === mock.token);
    const me = mock.db.data.users.find((u) => u.id === session?.userId);
    // The signed-in administrator, as the page reads it.
    const auth = {
      user: signal(me ? toUser(me, mock.db.data, TEST_NOW) : null),
      updateUser: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        ...mock.providers,
        { provide: AuthService, useValue: auth },
        ...(demo ? [] : [{ provide: DEMO_ACCOUNTS, useValue: null }]),
      ],
    });
    const fixture = TestBed.createComponent(EmployeeList);
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const list = () =>
      fixture.debugElement.query(By.directive(SdList))?.componentInstance as
        SdList<User> | undefined;
    const buttons = (text: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
        (b) => b.textContent?.trim() === text,
      );
    const click = async (text: string, index = 0) => {
      const button = buttons(text)[index];
      if (!button) throw new Error(`No button "${text}"`);
      button.click();
      await fixture.whenStable();
    };
    const fieldInput = (label: string) => {
      const field = [...document.querySelectorAll('sd-drawer sd-field')].find((f) =>
        f.textContent?.includes(label),
      );
      const input = field?.querySelector<HTMLInputElement>('input');
      if (!input) throw new Error(`No input for ${label}`);
      return input;
    };
    const type = async (label: string, value: string) => {
      const input = fieldInput(label);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const settle = async () => {
      await fixture.whenStable();
      await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).toBeNull());
      await fixture.whenStable();
    };
    const row = (firstName: string) => {
      const user = list()
        ?.items()
        .find((u) => u.firstName === firstName);
      if (!user) throw new Error(`No row ${firstName}`);
      return user;
    };
    const column = (id: string) =>
      list()
        ?.columns()
        .find((c) => c.id === id);
    const visibleActions = (user: User) =>
      (list()?.actions() ?? []).filter((a) => !a.hidden?.(user)).map((a) => a.id);
    /** The token of the invite link shown on the page, or null. */
    const shownInviteToken = () => {
      const value = element.querySelector<HTMLInputElement>('app-demo-link input')?.value;
      return value ? new URL(value).searchParams.get('token') : null;
    };
    return {
      fixture,
      element,
      mock,
      me,
      auth,
      shownInviteToken,
      list,
      buttons,
      click,
      fieldInput,
      type,
      settle,
      row,
      column,
      visibleActions,
      toasts: TestBed.inject(ToastService),
    };
  }

  it('lists every user with department, role, status and training counts', async () => {
    const { element, list, mock, row, column } = await render();

    expect(element.querySelector('sd-status-bar')?.textContent).toContain('Employees');
    expect(element.textContent).toContain('New employee');
    expect(list()?.items()).toHaveLength(mock.db.data.users.length);
    expect(
      list()
        ?.columns()
        .filter((c) => !list()?.hiddenColumns().has(c.id))
        .map((c) => c.label),
    ).toEqual(['Name', 'Email', 'Department', 'Role', 'Status', 'Invite', 'Assigned', 'Completed']);

    const oliver = row('Oliver');
    expect(column('email')?.value(oliver)).toBe('oliver.grant@brightwater.example');
    expect(column('department')?.value(oliver)).toBe('Finance');
    expect(column('department')?.subValue?.(oliver)).toBeNull();
    expect(column('role')?.value(oliver)).toBe('Employee');
    expect(column('status')?.value(oliver)).toBe('Active');
    expect(column('assignedTrainingCount')?.value(oliver)).toBe(oliver.assignedTrainingCount);
    expect(column('completedTrainingCount')?.value(oliver)).toBe(oliver.completedTrainingCount);
    expect(column('status')?.value(row('Sofia'))).toBe('Inactive');
    expect(column('role')?.value(row('Daniel'))).toBe('Administrator');
    expect(column('department')?.value(row('Ruth'))).toBe('No department');
  });

  it('marks a department that is inactive', async () => {
    const { row, column } = await render();
    const patrick = row('Patrick');

    expect(column('department')?.value(patrick)).toBe('Facilities');
    expect(column('department')?.subValue?.(patrick)).toBe('Inactive department');
  });

  it('searches names and emails, and filters by status, role and department', async () => {
    const { list, column } = await render();

    expect(list()?.searchable()).toBe(true);
    expect(
      list()
        ?.columns()
        .filter((c) => c.searchable !== false)
        .map((c) => c.id),
    ).toEqual(['name', 'email', 'search']);
    // The search-only column is never shown, and not offered in the Columns menu.
    expect([...(list()?.hiddenColumns() ?? [])]).toEqual(['search']);
    expect(column('search')?.hideable).toBeFalsy();
    const filters = list()?.filters() ?? [];
    expect(filters.map((f) => f.label)).toEqual(['Status', 'Role', 'Invite', 'Department']);
    const departments = filters.find((f) => f.id === 'department')?.options ?? [];
    expect(departments[0]).toEqual({ value: 'none', label: 'No department' });
    expect(departments.map((o) => o.label)).toContain('Facilities (inactive)');
    expect(column('name')).toBeDefined();
  });

  it('finds a name whatever kind of apostrophe is typed', async () => {
    const { list } = await render();
    // How sd-list searches: the lower-case query is contained in a searchable column's value.
    const matches = (query: string) =>
      (list()?.items() ?? [])
        .filter((u) =>
          (list()?.columns() ?? [])
            .filter((c) => c.searchable !== false)
            .some((c) =>
              String(c.value(u) ?? '')
                .toLowerCase()
                .includes(query.toLowerCase()),
            ),
        )
        .map((u) => `${u.firstName} ${u.lastName}`);

    expect(matches("o'neill")).toEqual(['Patrick O’Neill']);
    expect(matches('O’NEILL')).toEqual(['Patrick O’Neill']);
    expect(matches('oliver.grant@')).toEqual(['Oliver Grant']);
  });

  it('shows the no-access state on 403, without the New employee button', async () => {
    const { element } = await render({ flags: { errorStatus: 403 } });

    expect(element.querySelector('app-access-denied')?.textContent).toContain(
      "You don't have permission to see employees.",
    );
    expect(element.textContent).not.toContain('New employee');
  });

  it('shows an error with a retry button when loading fails', async () => {
    const { element } = await render({ flags: { errorStatus: 500 } });

    expect(element.querySelector('sd-callout')?.textContent).toContain('Could not load employees');
    expect(element.textContent).toContain('Try again');
  });

  it('shows the empty state when there are no users', async () => {
    const { element } = await render({ flags: { empty: true } });

    expect(element.textContent).toContain('No employees yet');
  });

  it('creates an employee and says an invite was sent', async () => {
    const { element, click, type, settle, list, mock, toasts, shownInviteToken } = await render();

    await click('New employee');
    expect(document.querySelector('sd-drawer')?.textContent).toContain('New employee');
    await type('First name', ' Hana ');
    await type('Last name', 'Sato');
    await type('Email', 'hana.sato@brightwater.example ');
    await click('Create employee');
    await settle();

    await vi.waitFor(() =>
      expect(
        list()
          ?.items()
          .map((u) => u.firstName),
      ).toContain('Hana'),
    );
    expect(mock.db.data.users.find((u) => u.firstName === 'Hana')).toMatchObject({
      email: 'hana.sato@brightwater.example',
      role: 'employee',
      departmentId: null,
      invitationSentAt: TEST_NOW.toISOString(),
      passwordSetAt: null,
    });
    expect(toasts.toasts()).toEqual([
      expect.objectContaining({
        heading: 'Employee created',
        message: 'An invite to set a password was sent to hana.sato@brightwater.example.',
      }),
    ]);
    expect(element.querySelector('app-employee-form')).toBeNull();

    // Demo only: the invite link is on the page, labelled as such, with a copy button.
    const hana = mock.db.data.users.find((u) => u.firstName === 'Hana');
    const demoLink = element.querySelector('app-demo-link');
    expect(demoLink?.textContent).toContain('Demo only: invite link for Hana Sato');
    expect(demoLink?.textContent).toContain('Copy invite link');
    expect(mock.db.data.accountLinks.find((l) => l.token === shownInviteToken())?.userId).toBe(
      hana?.id,
    );
  });

  it('shows no invite link when the demo is off', async () => {
    const { element, click, type, settle, toasts } = await render({}, { demo: false });

    await click('New employee');
    await type('First name', 'Hana');
    await type('Last name', 'Sato');
    await type('Email', 'hana.sato@brightwater.example');
    await click('Create employee');
    await settle();

    await vi.waitFor(() => expect(toasts.toasts()).toHaveLength(1));
    expect(element.querySelector('app-demo-link')).toBeNull();
  });

  it('shows each invite as pending, expired or accepted', async () => {
    const { list, row, column } = await render();
    const expired = list()
      ?.items()
      .find((u) => u.invitationStatus === 'expired');

    expect(column('invitation')?.value(row('Aisha'))).toBe('Pending');
    expect(column('invitation')?.value(expired!)).toBe('Expired');
    expect(column('invitation')?.value(row('Oliver'))).toBe('Accepted');
    expect(column('invitation')?.tone?.(expired!)).toBe('warning');
  });

  it('sends the invite again: the old link stops working and the new one is shown', async () => {
    const { fixture, list, row, mock, toasts, settle, shownInviteToken, visibleActions } =
      await render();
    const aisha = row('Aisha');
    expect(visibleActions(aisha)).toContain('resend');

    list()?.actionClick.emit({ action: 'resend', row: aisha });
    await fixture.whenStable();
    await settle();
    await vi.waitFor(() => expect(shownInviteToken()).not.toBeNull());
    const first = shownInviteToken();

    list()?.actionClick.emit({ action: 'resend', row: row('Aisha') });
    await vi.waitFor(() => expect(shownInviteToken()).not.toBe(first));
    await fixture.whenStable();

    const links = mock.db.data.accountLinks.filter((l) => l.userId === aisha.id);
    expect(links.map((l) => l.token)).toEqual([shownInviteToken()]);
    expect(toasts.toasts().map((t) => t.heading)).toEqual([
      'Invite sent again',
      'Invite sent again',
    ]);
    expect(toasts.toasts()[0].message).toContain('The old link no longer works.');
  });

  it('shows a toast when sending the invite again fails', async () => {
    let flags = {};
    const { fixture, list, row, toasts } = await render({ flags: () => flags });
    // The list has loaded; now the invite fails.
    flags = { errorStatus: 500 };

    list()?.actionClick.emit({ action: 'resend', row: row('Aisha') });
    await fixture.whenStable();

    await vi.waitFor(() =>
      expect(toasts.toasts()).toEqual([
        expect.objectContaining({ tone: 'danger', heading: 'Could not send the invite' }),
      ]),
    );
  });

  it('refreshes the signed-in user after an administrator edits their own name', async () => {
    const { fixture, click, type, settle, list, row, me, auth } = await render();

    list()?.rowClick.emit(row(me!.firstName));
    await fixture.whenStable();
    await type('First name', 'Marija');
    await click('Save changes');
    await settle();

    await vi.waitFor(() =>
      expect(auth.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: me!.id, firstName: 'Marija' }),
      ),
    );
  });

  it('shows an email already in use on the email field and keeps the drawer open', async () => {
    const { click, type, settle, mock, toasts } = await render();
    const count = mock.db.data.users.length;

    await click('New employee');
    await type('First name', 'Oliver');
    await type('Last name', 'Grant');
    await type('Email', 'OLIVER.GRANT@brightwater.example');
    await click('Create employee');
    await settle();

    await vi.waitFor(() =>
      expect(document.querySelector('sd-drawer')?.textContent).toContain(
        'A user with this email already exists.',
      ),
    );
    expect(mock.db.data.users).toHaveLength(count);
    expect(toasts.toasts()).toEqual([]);
  });

  it('checks the fields before sending', async () => {
    const { click, type, mock } = await render();
    const count = mock.db.data.users.length;

    await click('New employee');
    await type('First name', '   ');
    await type('Email', 'hana');
    await click('Create employee');

    const drawer = document.querySelector('sd-drawer')?.textContent;
    expect(drawer).toContain('Enter a first name.');
    expect(drawer).toContain('Enter a last name.');
    expect(drawer).toContain('Enter a valid email address.');
    expect(mock.db.data.users).toHaveLength(count);
  });

  it('edits an employee from their row', async () => {
    const { fixture, click, type, fieldInput, settle, list, row, toasts } = await render();

    list()?.rowClick.emit(row('Oliver'));
    await fixture.whenStable();
    expect(document.querySelector('sd-drawer')?.textContent).toContain('Edit employee');
    expect(fieldInput('Email').value).toBe('oliver.grant@brightwater.example');
    await type('Last name', 'Grant-Hill');
    await click('Save changes');
    await settle();

    await vi.waitFor(() => expect(row('Oliver').lastName).toBe('Grant-Hill'));
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Employee saved']);
  });

  it('closes without saving or a toast when nothing changed', async () => {
    const { fixture, element, click, settle, list, row, mock, toasts } = await render();
    const logSize = mock.db.data.auditLog.length;
    const { updatedAt } = row('Oliver');

    list()?.rowClick.emit(row('Oliver'));
    await fixture.whenStable();
    await click('Save changes');
    await settle();

    await vi.waitFor(() => expect(element.querySelector('app-employee-form')).toBeNull());
    expect(mock.db.data.auditLog).toHaveLength(logSize);
    expect(mock.db.data.users.find((u) => u.firstName === 'Oliver')?.updatedAt).toBe(updatedAt);
    expect(toasts.toasts()).toEqual([]);
  });

  it('deactivates an employee after a confirmation that explains what happens', async () => {
    const { fixture, click, settle, list, row, mock, toasts } = await render();
    const oliver = row('Oliver');

    list()?.actionClick.emit({ action: 'deactivate', row: oliver });
    await fixture.whenStable();
    const dialog = document.querySelector('sd-dialog')?.textContent;
    expect(dialog).toContain('Deactivate employee?');
    expect(dialog).toContain('will be signed out at once and can no longer sign in.');
    expect(dialog).toContain('Their training results are kept.');
    expect(dialog).toContain('left out of pending and overdue counts');
    await click('Deactivate');
    await settle();

    await vi.waitFor(() => expect(row('Oliver').status).toBe('inactive'));
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Employee deactivated']);
    expect(mock.db.data.auditLog.at(-1)).toMatchObject({
      action: 'deactivated',
      entityType: 'user',
      entityId: oliver.id,
    });
  });

  it('reactivates an inactive employee', async () => {
    const { fixture, click, settle, list, row, toasts } = await render();

    list()?.actionClick.emit({ action: 'reactivate', row: row('Sofia') });
    await fixture.whenStable();
    expect(document.querySelector('sd-dialog')?.textContent).toContain('Reactivate employee?');
    await click('Reactivate');
    await settle();

    await vi.waitFor(() => expect(row('Sofia').status).toBe('active'));
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Employee reactivated']);
  });

  it('offers deactivate only for other active users, and reactivate for inactive ones', async () => {
    const { row, me, column, visibleActions } = await render();
    const own = row(me?.firstName ?? '');

    expect(visibleActions(row('Oliver'))).toEqual(['edit', 'deactivate']);
    expect(visibleActions(row('Daniel'))).toEqual(['edit', 'deactivate']);
    expect(visibleActions(row('Sofia'))).toEqual(['edit', 'reactivate']);
    expect(visibleActions(row('Aisha'))).toEqual(['edit', 'resend', 'deactivate']);
    expect(visibleActions(own)).toEqual(['edit']);
    expect(column('name')?.subValue?.(own)).toBe('You');
  });
});
