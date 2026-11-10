import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { SdList } from '@specora-dev/ui-kit';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import type { Department } from '../../core/api';
import { ToastService } from '../../core/toast';
import { DepartmentList } from './department-list';

describe('Departments page', () => {
  async function render(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), ...mock.providers],
    });
    const fixture = TestBed.createComponent(DepartmentList);
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const list = () =>
      fixture.debugElement.query(By.directive(SdList))?.componentInstance as
        SdList<Department> | undefined;
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
    const type = async (selector: string, value: string) => {
      const input = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      if (!input) throw new Error(`No ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const settle = async () => {
      await fixture.whenStable();
      await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).toBeNull());
      await fixture.whenStable();
    };
    const row = (name: string) => {
      const department = list()
        ?.items()
        .find((d) => d.name === name);
      if (!department) throw new Error(`No row ${name}`);
      return department;
    };
    return {
      fixture,
      element,
      mock,
      list,
      buttons,
      click,
      type,
      settle,
      row,
      toasts: TestBed.inject(ToastService),
    };
  }

  it('lists every department with its employee count and status', async () => {
    const { element, list, mock } = await render();

    expect(element.querySelector('sd-status-bar')?.textContent).toContain('Departments');
    expect(element.textContent).toContain('New department');
    const items = list()?.items() ?? [];
    expect(items).toHaveLength(mock.db.data.departments.length);
    const columns = list()?.columns() ?? [];
    expect(columns.map((c) => c.label)).toEqual(['Name', 'Description', 'Employees', 'Status']);
    const facilities = items.find((d) => d.name === 'Facilities');
    const status = columns.find((c) => c.id === 'status');
    expect(status?.value(facilities!)).toBe('Inactive');
    expect(items.every((d) => typeof d.employeeCount === 'number')).toBe(true);
    expect(
      list()
        ?.filters()
        .map((f) => f.label),
    ).toEqual(['Status']);
    expect(list()?.searchable()).toBe(true);
  });

  it('shows the no-access state on 403, without the New department button', async () => {
    const { element } = await render({ flags: { errorStatus: 403 } });

    expect(element.querySelector('app-access-denied')?.textContent).toContain(
      "You don't have permission to see departments.",
    );
    expect(element.textContent).not.toContain('New department');
  });

  it('shows an error with a retry button when loading fails', async () => {
    const { element } = await render({ flags: { errorStatus: 500 } });

    expect(element.querySelector('sd-callout')?.textContent).toContain(
      'Could not load departments',
    );
    expect(element.textContent).toContain('Try again');
  });

  it('shows the empty state when there are no departments', async () => {
    const { element } = await render({ flags: { empty: true } });

    expect(element.textContent).toContain('No departments yet');
  });

  it('creates a department and confirms it with a toast', async () => {
    const { element, click, type, settle, list, mock, toasts } = await render();

    await click('New department');
    expect(document.querySelector('sd-drawer')?.textContent).toContain('New department');
    await type('sd-drawer input', '  Legal ');
    await type('sd-drawer textarea', 'Contracts and compliance.');
    await click('Create department');
    await settle();

    await vi.waitFor(() =>
      expect(
        list()
          ?.items()
          .map((d) => d.name),
      ).toContain('Legal'),
    );
    expect(mock.db.data.departments.find((d) => d.name === 'Legal')?.description).toBe(
      'Contracts and compliance.',
    );
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Department created']);
    expect(element.querySelector('app-department-form')).toBeNull();
  });

  it('shows a duplicate name on the name field and keeps the drawer open', async () => {
    const { click, type, settle, mock, toasts } = await render();

    await click('New department');
    await type('sd-drawer input', 'FINANCE');
    await click('Create department');
    await settle();

    await vi.waitFor(() =>
      expect(document.querySelector('sd-drawer sd-field')?.textContent).toContain(
        'A department with this name already exists.',
      ),
    );
    expect(mock.db.data.departments.filter((d) => d.name.toLowerCase() === 'finance')).toHaveLength(
      1,
    );
    expect(toasts.toasts()).toEqual([]);
  });

  it('checks the name before sending', async () => {
    const { click, type, mock } = await render();
    const count = mock.db.data.departments.length;

    await click('New department');
    await type('sd-drawer input', '   ');
    await click('Create department');

    expect(document.querySelector('sd-drawer sd-field')?.textContent).toContain('Enter a name.');
    expect(mock.db.data.departments).toHaveLength(count);
  });

  it('renames a department from its row', async () => {
    const { fixture, click, type, settle, list, row, toasts } = await render();

    list()?.rowClick.emit(row('Sales'));
    await fixture.whenStable();
    expect(document.querySelector('sd-drawer')?.textContent).toContain('Edit department');
    expect(document.querySelector<HTMLInputElement>('sd-drawer input')?.value).toBe('Sales');
    await type('sd-drawer input', 'Sales & Partnerships');
    await click('Save changes');
    await settle();

    await vi.waitFor(() =>
      expect(
        list()
          ?.items()
          .map((d) => d.name),
      ).toContain('Sales & Partnerships'),
    );
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Department saved']);
  });

  it('deactivates a department after a confirmation that explains what happens', async () => {
    const { fixture, click, settle, list, row, mock, toasts } = await render();
    const finance = row('Finance');

    list()?.actionClick.emit({ action: 'deactivate', row: finance });
    await fixture.whenStable();
    const dialog = document.querySelector('sd-dialog');
    expect(dialog?.textContent).toContain('Deactivate department?');
    expect(dialog?.textContent).toContain(
      'Its history is kept, and its employees keep their department.',
    );
    await click('Deactivate');
    await settle();

    await vi.waitFor(() => expect(row('Finance').status).toBe('inactive'));
    expect(mock.db.data.departments.find((d) => d.id === finance.id)?.status).toBe('inactive');
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Department deactivated']);
    expect(mock.db.data.auditLog.at(-1)).toMatchObject({
      action: 'deactivated',
      entityId: finance.id,
    });
  });

  it('reactivates an inactive department', async () => {
    const { fixture, click, settle, list, row, toasts } = await render();

    list()?.actionClick.emit({ action: 'reactivate', row: row('Facilities') });
    await fixture.whenStable();
    expect(document.querySelector('sd-dialog')?.textContent).toContain('Reactivate department?');
    await click('Reactivate');
    await settle();

    await vi.waitFor(() => expect(row('Facilities').status).toBe('active'));
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Department reactivated']);
  });

  it('offers deactivate only for active and reactivate only for inactive departments', async () => {
    const { list, row } = await render();
    const actions = list()?.actions() ?? [];
    const visible = (d: Department) => actions.filter((a) => !a.hidden?.(d)).map((a) => a.id);

    expect(visible(row('Finance'))).toEqual(['edit', 'deactivate']);
    expect(visible(row('Facilities'))).toEqual(['edit', 'reactivate']);
  });
});
