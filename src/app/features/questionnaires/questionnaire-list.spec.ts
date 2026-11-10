import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { SdList } from '@specora-dev/ui-kit';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import type { Questionnaire } from '../../core/api';
import { ToastService } from '../../core/toast';
import { QuestionnaireForm } from './questionnaire-form';
import { QuestionnaireList } from './questionnaire-list';

describe('Questionnaires page', () => {
  async function render(options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), ...mock.providers],
    });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(QuestionnaireList);
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const list = () =>
      fixture.debugElement.query(By.directive(SdList))?.componentInstance as
        SdList<Questionnaire> | undefined;
    const click = async (text: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === text,
      );
      if (!button) throw new Error(`No button "${text}"`);
      button.click();
      await fixture.whenStable();
    };
    const type = async (selector: string, value: string) => {
      const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      if (!input) throw new Error(`No ${selector}`);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const row = (title: string) => {
      const questionnaire = list()
        ?.items()
        .find((q) => q.title === title);
      if (!questionnaire) throw new Error(`No row ${title}`);
      return questionnaire;
    };
    const column = (id: string) =>
      list()
        ?.columns()
        .find((c) => c.id === id);
    return {
      fixture,
      element,
      mock,
      list,
      click,
      type,
      row,
      column,
      navigate,
      toasts: TestBed.inject(ToastService),
    };
  }

  it('lists every questionnaire with topic, questions, passing score, status and creation date', async () => {
    const { element, list, row, column, mock } = await render();

    expect(element.querySelector('sd-status-bar')?.textContent).toContain('Questionnaires');
    expect(element.textContent).toContain('New questionnaire');
    expect(list()?.items()).toHaveLength(mock.db.data.questionnaires.length);
    expect(
      list()
        ?.columns()
        .map((c) => c.label),
    ).toEqual(['Title', 'Topic', 'Questions', 'Passing score', 'Status', 'Created']);
    const draft = row('Reporting suspicious messages');
    expect(column('topic')?.value(draft)).toBe('Phishing Awareness');
    expect(column('questionCount')?.value(draft)).toBe(0);
    expect(column('passingScore')?.value(draft)).toBe('80%');
    expect(column('status')?.value(draft)).toBe('Inactive');
    expect(column('createdAt')?.value(draft)).toBe('Nov 7, 2026');
    expect(column('status')?.value(row('Handling personal data'))).toBe('Active');
    expect(column('passingScore')?.value(row('Handling personal data'))).toBe('90%');
    expect(list()?.searchable()).toBe(true);
    expect(
      list()
        ?.columns()
        .filter((c) => c.searchable !== false)
        .map((c) => c.id),
    ).toEqual(['title']);
    expect(list()?.sort()).toEqual({ columnId: 'title', dir: 'asc' });
  });

  it('filters by topic and status, with every topic as an option', async () => {
    const { list, mock } = await render();

    const filters = list()?.filters() ?? [];
    expect(filters.map((f) => f.label)).toEqual(['Topic', 'Status']);
    expect(filters[0].options?.map((o) => o.label)).toEqual(
      mock.db.data.topics.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    );
    expect(filters[1].options?.map((o) => o.label)).toEqual(['Active', 'Inactive']);
  });

  it('shows the no-access state on 403, without the New questionnaire button', async () => {
    const { element } = await render({ flags: { errorStatus: 403 } });

    expect(element.querySelector('app-access-denied')?.textContent).toContain(
      "You don't have permission to manage questionnaires.",
    );
    expect(element.textContent).not.toContain('New questionnaire');
  });

  it('shows an error with a retry button when loading fails', async () => {
    const { element } = await render({ flags: { errorStatus: 500 } });

    expect(element.querySelector('sd-callout')?.textContent).toContain(
      'Could not load questionnaires',
    );
    expect(element.textContent).toContain('Try again');
  });

  it('shows the empty state when there are no questionnaires', async () => {
    const { element } = await render({ flags: { empty: true } });

    expect(element.textContent).toContain('No questionnaires yet');
  });

  it('creates an inactive draft in the drawer, then opens its page with a toast', async () => {
    const { fixture, click, type, mock, navigate, toasts } = await render();

    await click('New questionnaire');
    expect(document.querySelector('sd-drawer')?.textContent).toContain(
      'A new questionnaire starts inactive',
    );
    await type('sd-drawer input', '  USB sticks ');
    const form = fixture.debugElement.query(By.directive(QuestionnaireForm)).componentInstance;
    const deviceSecurity = mock.db.data.topics.find((t) => t.name === 'Device Security')!.id;
    // sd-select has no native control; set the value the way the picker does.
    form['model'].update((m: object) => ({ ...m, topicId: deviceSecurity }));
    await fixture.whenStable();
    await click('Create questionnaire');

    await vi.waitFor(() =>
      expect(mock.db.data.questionnaires.find((q) => q.title === 'USB sticks')).toMatchObject({
        topicId: deviceSecurity,
        passingScore: 80,
        timeLimitMinutes: null,
        status: 'inactive',
      }),
    );
    const created = mock.db.data.questionnaires.find((q) => q.title === 'USB sticks')!;
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(['/admin/questionnaires', created.id]),
    );
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Questionnaire created']);
  });

  it('opens the detail page from a row and from the open action', async () => {
    const { fixture, list, row, navigate } = await render();
    const questionnaire = row('Handling personal data');

    list()?.rowClick.emit(questionnaire);
    list()?.actionClick.emit({ action: 'open', row: questionnaire });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith(['/admin/questionnaires', questionnaire.id]);
  });

  it('deactivates after a confirmation that says existing assignments can still be completed', async () => {
    const { fixture, click, list, row, mock, toasts } = await render();
    const questionnaire = row('Handling personal data');

    list()?.actionClick.emit({ action: 'deactivate', row: questionnaire });
    await fixture.whenStable();
    const text = document.querySelector('sd-dialog')?.textContent?.replace(/\s+/g, ' ');
    expect(text).toContain('Deactivate questionnaire?');
    expect(text).toContain('it can no longer be assigned');
    expect(text).toContain('Employees who already have it assigned can still complete it');
    await click('Deactivate');

    await vi.waitFor(() => expect(row('Handling personal data').status).toBe('inactive'));
    expect(mock.db.data.questionnaires.find((q) => q.id === questionnaire.id)?.status).toBe(
      'inactive',
    );
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Questionnaire deactivated']);
  });

  it('offers deactivate for active questionnaires, and activate only once one has questions', async () => {
    const { list, row } = await render();
    const actions = list()?.actions() ?? [];
    const visible = (q: Questionnaire) => actions.filter((a) => !a.hidden?.(q)).map((a) => a.id);
    const activate = actions.find((a) => a.id === 'activate');

    expect(visible(row('Handling personal data'))).toEqual(['open', 'deactivate']);
    expect(visible(row('Password basics (2025)'))).toEqual(['open', 'activate']);
    expect(activate?.disabled?.(row('Password basics (2025)'))).toBe(false);
    expect(activate?.disabled?.(row('Reporting suspicious messages'))).toBe(true);
  });
});
