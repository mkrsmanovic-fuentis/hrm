import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SdList } from '@specora-dev/ui-kit';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import type { Assignment } from '../../core/api';
import { ToastService } from '../../core/toast';
import { AssignTrainingForm } from '../../shared/assign-training/assign-training-form';
import { AssignmentList } from './assignment-list';
import { ChangeDeadlineDialog } from './change-deadline-dialog';

describe('Assignments page', () => {
  async function render(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const fixture = TestBed.createComponent(AssignmentList);
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).toBeNull());
    await fixture.whenStable();

    const list = () =>
      fixture.debugElement.query(By.directive(SdList))?.componentInstance as
        SdList<Assignment> | undefined;
    const text = () => element.textContent?.replace(/\s+/g, ' ') ?? '';
    const button = (label: string) =>
      [...element.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === label,
      );
    return { fixture, element, mock, list, text, button, toasts: TestBed.inject(ToastService) };
  }

  it('lists every assignment, newest first, with employee, department, questionnaire and dates', async () => {
    const { list, mock } = await render();

    const items = list()!.items();
    expect(items).toHaveLength(mock.db.data.assignments.length);
    const columns = list()!
      .columns()
      .map((c) => c.label);
    expect(columns).toEqual([
      'Employee',
      'Department',
      'Questionnaire',
      'Deadline',
      'Status',
      'Completed',
      'Assigned',
      'Search',
    ]);
    expect(list()!.sort()).toEqual({ columnId: 'createdAt', dir: 'desc' });
    expect(list()!.hiddenColumns().has('search')).toBe(true);
  });

  it('shows statuses as labelled badges', async () => {
    const { list } = await render();
    const status = list()!
      .columns()
      .find((c) => c.id === 'status')!;
    const overdue = list()!
      .items()
      .find((a) => a.status === 'overdue')!;

    expect(status.value(overdue)).toBe('Overdue');
    expect(status.tone?.(overdue)).toBe('danger');
  });

  it('shows the completion date, and marks passes after the deadline as late', async () => {
    const { list } = await render();
    const completed = list()!
      .columns()
      .find((c) => c.id === 'completedAt')!;
    const items = list()!.items();
    const late = items.find(
      (a) => a.completedAt !== null && Date.parse(a.completedAt) > Date.parse(a.dueAt),
    )!;
    const onTime = items.find(
      (a) => a.completedAt !== null && Date.parse(a.completedAt) <= Date.parse(a.dueAt),
    )!;
    const open = items.find((a) => a.status !== 'passed')!;

    expect(late.status).toBe('passed');
    expect(completed.value(late)).not.toBeNull();
    expect(completed.subValue?.(late)).toBe('Late');
    expect(completed.subValue?.(onTime)).toBeNull();
    expect(completed.value(open)).toBeNull();
  });

  it('filters by status and sorts by deadline', async () => {
    const { list, fixture, element } = await render();
    const filter = list()!.filters()[0];
    expect(filter.label).toBe('Status');
    expect(filter.options?.map((o) => o.label)).toEqual([
      'Not started',
      'In progress',
      'Failed',
      'Overdue',
      'Passed',
    ]);

    list()!.filterValues.set({ status: 'overdue' });
    await fixture.whenStable();
    const overdueCount = list()!
      .items()
      .filter((a) => a.status === 'overdue').length;
    expect(element.textContent).toContain(
      `${overdueCount} of ${list()!.items().length} assignments`,
    );

    const deadline = list()!
      .columns()
      .find((c) => c.id === 'dueAt')!;
    expect(deadline.sortable).toBe(true);
  });

  it('offers Change deadline on every assignment that is not passed', async () => {
    const { list } = await render();
    const action = list()!
      .actions()
      .find((a) => a.id === 'change-deadline')!;
    const items = list()!.items();

    expect(action.label).toBe('Change deadline');
    expect(action.hidden?.(items.find((a) => a.status === 'passed')!)).toBe(true);
    expect(action.hidden?.(items.find((a) => a.status === 'overdue')!)).toBe(false);
  });

  it('changes a deadline from the dialog, then confirms and reloads the list', async () => {
    const { list, fixture, toasts, element } = await render();
    const overdue = list()!
      .items()
      .find((a) => a.status === 'overdue')!;

    list()!.actionClick.emit({ action: 'change-deadline', row: overdue });
    await fixture.whenStable();
    const dialog = fixture.debugElement.query(By.directive(ChangeDeadlineDialog));
    expect(dialog).not.toBeNull();
    expect(element.textContent).toContain('Change deadline');

    const dueAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    (dialog.componentInstance as ChangeDeadlineDialog).saved.emit({ ...overdue, dueAt });
    await fixture.whenStable();

    expect(toasts.toasts()).toEqual([
      expect.objectContaining({ tone: 'success', heading: 'Deadline changed' }),
    ]);
  });

  it('searches employee names ignoring the kind of apostrophe', async () => {
    const { list } = await render();
    const search = list()!
      .columns()
      .find((c) => c.id === 'search')!;
    const patrick = list()!
      .items()
      .find((a) => a.employeeName === 'Patrick O’Neill')!;

    expect(String(search.value(patrick))).toContain("Patrick O'Neill");
    expect(String(search.value(patrick))).toContain(patrick.questionnaireTitle);
  });

  it('opens the assign drawer, then confirms and lists skipped employees', async () => {
    const { fixture, button, toasts, element } = await render();

    button('Assign training')!.click();
    await fixture.whenStable();
    const drawer = fixture.debugElement.query(By.directive(AssignTrainingForm));
    expect(drawer).not.toBeNull();

    (drawer.componentInstance as AssignTrainingForm).saved.emit({
      questionnaireTitle: 'Handling personal data',
      createdCount: 3,
      skipped: [{ userId: 'u1', name: 'Amelia Hughes', reason: 'open_assignment' }],
    });
    await fixture.whenStable();

    expect(toasts.toasts()).toEqual([
      expect.objectContaining({
        tone: 'success',
        heading: '3 assignments created',
        message:
          'Handling personal data is assigned. 1 employee skipped: see the list on the page.',
      }),
    ]);
    const callout = element.querySelector('app-assign-result')?.textContent ?? '';
    expect(callout).toContain('1 employee skipped');
    expect(callout).toContain('Amelia Hughes');
    expect(callout).toContain('Already has an open assignment for this questionnaire.');
  });

  it('says so when no assignment was created', async () => {
    const { fixture, button, toasts } = await render();
    button('Assign training')!.click();
    await fixture.whenStable();

    (
      fixture.debugElement.query(By.directive(AssignTrainingForm))
        .componentInstance as AssignTrainingForm
    ).saved.emit({ questionnaireTitle: 'Handling personal data', createdCount: 0, skipped: [] });
    await fixture.whenStable();

    expect(toasts.toasts()).toEqual([
      expect.objectContaining({
        tone: 'warning',
        heading: 'No assignments created',
        message: 'The department has no active employees.',
      }),
    ]);
  });

  it('shows the no-access state on 403, without the Assign training button', async () => {
    const { element, button } = await render({ flags: { errorStatus: 403 } });

    expect(element.querySelector('app-access-denied')).not.toBeNull();
    expect(button('Assign training')).toBeUndefined();
  });

  it('shows the empty state when there are no assignments', async () => {
    const { text } = await render({ flags: { empty: true } });

    expect(text()).toContain('No assignments yet');
  });
});
