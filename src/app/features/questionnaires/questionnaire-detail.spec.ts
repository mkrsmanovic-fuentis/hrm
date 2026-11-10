import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { SdSelect, SdStatusBar } from '@specora-dev/ui-kit';
import { of } from 'rxjs';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import { ToastService } from '../../core/toast';
import { QuestionnaireDetail } from './questionnaire-detail';

describe('Questionnaire page', () => {
  async function render(title: string, options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    const id = mock.db.data.questionnaires.find((q) => q.title === title)?.id ?? 'missing';
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        ...mock.providers,
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ questionnaireId: id })) },
        },
      ],
    });
    const fixture = TestBed.createComponent(QuestionnaireDetail);
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).toBeNull());
    await fixture.whenStable();

    const text = () => element.textContent?.replace(/\s+/g, ' ') ?? '';
    /** The text of every dialog: the page has several, and only an open one has content. */
    const dialogText = () =>
      [...document.querySelectorAll('sd-dialog')].map((d) => d.textContent ?? '').join(' ');
    const button = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.trim() === label,
      );
    const click = async (label: string) => {
      const found = button(label);
      if (!found) throw new Error(`No button "${label}"`);
      found.click();
      await fixture.whenStable();
    };
    const statusBar = () =>
      fixture.debugElement.query(By.directive(SdStatusBar)).componentInstance as SdStatusBar;
    return {
      fixture,
      element,
      mock,
      id,
      text,
      dialogText,
      button,
      click,
      statusBar,
      toasts: TestBed.inject(ToastService),
    };
  }

  it('shows the settings, with the topic, passing score and time limit', async () => {
    const { text, statusBar } = await render('Handling personal data');

    expect(statusBar().heading()).toBe('Handling personal data');
    expect(statusBar().subtitle()).toBe('Data Protection');
    expect(
      statusBar()
        .breadcrumb()
        .map((b) => b.label),
    ).toEqual(['Questionnaires', 'Handling personal data']);
    expect(statusBar().stats()).toEqual([
      { label: 'Status', badge: { label: 'Active', tone: 'success' } },
      { label: 'Questions', value: expect.any(String) },
      { label: 'Passing score', value: '90%' },
      { label: 'Created', value: expect.any(String) },
    ]);
    expect(text()).toContain('Time limit15 minutes');
    expect(text()).toContain('Each attempt keeps the passing score it started with.');
    expect(text()).not.toContain('This questionnaire is a draft');
  });

  it('edits the questions in the Questions section, and updates the question count after a save', async () => {
    const { fixture, element, click, statusBar, dialogText } = await render(
      'Reporting suspicious messages',
    );
    await vi.waitFor(() => expect(element.textContent).toContain('No questions yet'));
    const page = fixture.componentInstance;

    expect(page.confirmLeave()).toBe(true);
    await click('Add question');
    const question = element.querySelector<HTMLTextAreaElement>('[data-question-text]')!;
    question.value = 'Where do you report a phishing email?';
    question.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    // Unsaved changes: leaving asks first.
    const leaving = page.confirmLeave();
    expect(leaving).toBeInstanceOf(Promise);
    await fixture.whenStable();
    expect(dialogText()).toContain('Leave without saving?');
    [...document.querySelectorAll<HTMLButtonElement>('sd-dialog button')]
      .find((b) => b.textContent?.trim() === 'Keep editing')!
      .click();
    await expect(leaving).resolves.toBe(false);

    for (const input of element.querySelectorAll<HTMLInputElement>('[data-option-text]')) {
      input.value = 'An answer';
      input.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
    await click('Save questions');

    await vi.waitFor(() =>
      expect(statusBar().stats()).toContainEqual({ label: 'Questions', value: '1' }),
    );
    expect(page.confirmLeave()).toBe(true);
  });

  it('blocks activating a draft without questions, and says why', async () => {
    const { text, button, element } = await render('Reporting suspicious messages');

    expect(text()).toContain("This questionnaire can't be activated yet");
    expect(text()).toContain('Fix 1 problem to activate this questionnaire.');
    expect(text()).toContain('The questionnaire has no questions. Add at least one question.');
    expect(button('Activate')?.disabled).toBe(true);
    expect(button('Activate')?.getAttribute('aria-describedby')).toBe('activation-problems');
    expect(element.querySelector('#activation-problems')).not.toBeNull();
    expect(button('Deactivate')).toBeUndefined();
    await vi.waitFor(() => expect(text()).toContain('Version 1: No questions, no attempts yet.'));
  });

  it('lists every incomplete question, jumps to one, and activates once it is fixed', async () => {
    const { fixture, element, text, button, click, mock, id, dialogText } = await render(
      'Phone scams and callback checks',
    );
    await vi.waitFor(() => expect(element.querySelectorAll('[data-question]')).toHaveLength(3));
    const problems = () =>
      [...element.querySelectorAll('#activation-problems li')].map((li) =>
        li.textContent?.replace(/\s+/g, ' ').trim(),
      );

    expect(text()).toContain('Fix 3 problems to activate this questionnaire.');
    expect(problems()).toEqual([
      'Question 2 has fewer than 2 answer options. Add at least 2. Go to question 2',
      'Question 2 has no correct answer. Choose one. Go to question 2',
      'Question 3 has no correct answer. Choose one. Go to question 3',
    ]);
    expect(button('Activate')?.disabled).toBe(true);
    // The editor shows the same problems on each question.
    const questions = () => [...element.querySelectorAll<HTMLElement>('[data-question]')];
    expect(questions()[0].querySelector('sd-callout')).toBeNull();
    expect(questions()[1].querySelector('sd-callout')?.textContent).toContain(
      'Question 2 has no correct answer. Choose one.',
    );

    // Jump to question 3: its text gets focus, and the question is highlighted.
    const goTo = [...element.querySelectorAll<HTMLButtonElement>('#activation-problems button')];
    goTo[2].click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(questions()[2].querySelector('[data-question-text]'));
    expect(questions()[2].classList).toContain('highlighted');
    expect(questions()[1].classList).not.toContain('highlighted');

    // Fix question 2 (a second answer, and a correct one) and question 3, then save.
    const selects = () =>
      fixture.debugElement
        .queryAll(By.directive(SdSelect))
        .map((d) => d.componentInstance as SdSelect<string>);
    const addOption = [...questions()[1].querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Add answer option',
    )!;
    addOption.click();
    await fixture.whenStable();
    const newOption = [
      ...questions()[1].querySelectorAll<HTMLInputElement>('[data-option-text]'),
    ][1];
    newOption.value = 'Change the details at once';
    newOption.dispatchEvent(new Event('input'));
    for (const [index, option] of [
      [1, 0],
      [2, 1],
    ]) {
      const select = selects()[index];
      select.value.set(select.options()[option].value);
    }
    await fixture.whenStable();
    expect(questions()[1].querySelector('sd-callout')).toBeNull();
    await click('Save questions');

    await vi.waitFor(() => expect(button('Activate')?.disabled).toBe(false));
    expect(element.querySelector('#activation-problems')).toBeNull();
    await click('Activate');
    expect(dialogText()).toContain('Activate questionnaire?');
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('sd-dialog button')].find(
      (b) => b.textContent?.trim() === 'Activate' && b.closest('sd-dialog')?.textContent,
    )!;
    confirm.click();

    await vi.waitFor(() =>
      expect(mock.db.data.questionnaires.find((q) => q.id === id)?.status).toBe('active'),
    );
    expect(mock.db.data.auditLog.at(-1)).toMatchObject({ action: 'activated', entityId: id });
  });

  it('says to choose another topic when the topic is inactive', async () => {
    const { fixture, text, button, click, element } = await render('Clean desk checklist');

    expect(text()).toContain(
      'The topic Clean Desk Policy is inactive. Choose another topic, or reactivate the topic.',
    );
    expect(button('Activate')?.disabled).toBe(true);
    expect(
      element.querySelector('#activation-problems a[href="/admin/topics"]')?.textContent?.trim(),
    ).toBe('Go to Topics');
    await click('Choose another topic');
    await fixture.whenStable();
    expect(document.querySelector('sd-drawer')?.textContent).toContain('Edit settings');
  });

  it('shows the problems in the dialog when activating is refused, and reloads the page', async () => {
    const { fixture, click, mock, id, dialogText, text } = await render('Password basics (2025)');
    // Someone else removes the correct answer after the page loaded.
    const record = mock.db.data.questionnaires.find((q) => q.id === id)!;
    const first = mock.db.data.questions.find(
      (q) => q.questionnaireVersionId === record.currentVersionId && q.position === 1,
    )!;
    for (const option of mock.db.data.answerOptions.filter((o) => o.questionId === first.id)) {
      option.isCorrect = false;
    }

    await click('Activate');
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('sd-dialog button')].find(
      (b) => b.textContent?.trim() === 'Activate',
    )!;
    confirm.click();
    await fixture.whenStable();

    await vi.waitFor(() =>
      expect(dialogText()).toContain('Question 1 has no correct answer. Choose one.'),
    );
    expect(dialogText()).toContain(
      "This questionnaire can't be activated yet. Fix 1 problem first.",
    );
    await vi.waitFor(() =>
      expect(text()).toContain('Fix 1 problem to activate this questionnaire.'),
    );
    expect(record.status).toBe('inactive');
  });

  it('edits the settings in the drawer, and confirms with a toast', async () => {
    const { fixture, click, mock, id, toasts, statusBar } = await render('Handling personal data');

    await click('Edit settings');
    expect(document.querySelector('sd-drawer')?.textContent).toContain('Edit settings');
    const title = document.querySelector<HTMLInputElement>('sd-drawer input')!;
    expect(title.value).toBe('Handling personal data');
    title.value = 'Handling personal data safely';
    title.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await click('Save changes');

    await vi.waitFor(() =>
      expect(mock.db.data.questionnaires.find((q) => q.id === id)?.title).toBe(
        'Handling personal data safely',
      ),
    );
    await vi.waitFor(() => expect(statusBar().heading()).toBe('Handling personal data safely'));
    expect(toasts.toasts().map((t) => t.heading)).toEqual(['Questionnaire saved']);
  });

  it('saves nothing and shows no toast when the edit changes nothing', async () => {
    const { fixture, click, mock, toasts } = await render('Handling personal data');
    const logSize = mock.db.data.auditLog.length;

    await click('Edit settings');
    await click('Save changes');
    await vi.waitFor(() =>
      expect(fixture.nativeElement.querySelector('app-questionnaire-form')).toBeNull(),
    );

    expect(mock.db.data.auditLog).toHaveLength(logSize);
    expect(toasts.toasts()).toEqual([]);
  });

  it('deactivates and activates again after confirmations', async () => {
    const { click, button, mock, id, toasts, dialogText } = await render(
      'Multi-factor authentication',
    );
    const status = () => mock.db.data.questionnaires.find((q) => q.id === id)?.status;

    const confirm = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('sd-dialog button')]
        .find((b) => b.textContent?.trim() === label)!
        .click();

    await click('Deactivate');
    expect(dialogText()).toContain('Deactivate questionnaire?');
    confirm('Deactivate');
    await vi.waitFor(() => expect(status()).toBe('inactive'));
    await vi.waitFor(() => expect(button('Activate')?.disabled).toBe(false));

    await click('Activate');
    expect(dialogText()).toContain('Activate questionnaire?');
    confirm('Activate');
    await vi.waitFor(() => expect(status()).toBe('active'));

    expect(toasts.toasts().map((t) => t.heading)).toEqual([
      'Questionnaire deactivated',
      'Questionnaire activated',
    ]);
  });

  it('shows not found for an unknown questionnaire', async () => {
    const { text } = await render('No such questionnaire');

    expect(text()).toContain('Questionnaire not found');
    expect(text()).toContain('All questionnaires');
  });

  it('shows the no-access state on 403', async () => {
    const { element } = await render('Handling personal data', { flags: { errorStatus: 403 } });

    expect(element.querySelector('app-access-denied')).not.toBeNull();
  });
});
