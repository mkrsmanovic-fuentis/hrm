import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SdSelect } from '@specora-dev/ui-kit';
import { createTestMockApi, type TestMockApiOptions } from '../../../mocks/testing';
import { questionsOfVersion, toQuestionnaire } from '../../../mocks/rules/questionnaire-rules';
import { ToastService } from '../../core/toast';
import { QuestionEditor } from './question-editor';
import { unsavedChangesGuard } from './unsaved-changes.guard';

describe('Question editor', () => {
  const WITH_ATTEMPTS = 'Spotting phishing emails';
  const DRAFT = 'Reporting suspicious messages';

  async function render(title: string, options: TestMockApiOptions = {}) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({ providers: [provideHttpClient(), ...mock.providers] });
    const record = mock.db.data.questionnaires.find((q) => q.title === title);
    if (!record) throw new Error(`No seeded questionnaire ${title}`);
    const fixture = TestBed.createComponent(QuestionEditor);
    fixture.componentRef.setInput('questionnaire', toQuestionnaire(record, mock.db.data));
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).toBeNull());
    await fixture.whenStable();

    const stable = () => fixture.whenStable();
    const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
    const buttons = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
        (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
      );
    const button = (label: string) => buttons(label)[0];
    const click = async (label: string) => {
      const found = button(label);
      if (!found) throw new Error(`No button "${label}"`);
      found.click();
      await stable();
    };
    const dialogButton = async (label: string) => {
      const found = [...document.querySelectorAll<HTMLButtonElement>('sd-dialog button')].find(
        (b) => b.textContent?.trim() === label,
      );
      if (!found) throw new Error(`No dialog button "${label}"`);
      found.click();
      await stable();
    };
    const type = async (control: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      control.value = value;
      control.dispatchEvent(new Event('input'));
      await stable();
    };
    const questionTexts = () =>
      [...element.querySelectorAll<HTMLTextAreaElement>('[data-question-text]')].map(
        (t) => t.value,
      );
    const questionText = (index: number) =>
      element.querySelectorAll<HTMLTextAreaElement>('[data-question-text]')[index];
    const optionInputs = (questionIndex: number) => {
      const question = element.querySelectorAll('.question')[questionIndex];
      return [...question.querySelectorAll<HTMLInputElement>('[data-option-text]')];
    };
    const chooseCorrect = async (questionIndex: number, optionIndex: number) => {
      const select = fixture.debugElement.queryAll(By.directive(SdSelect))[questionIndex]
        .componentInstance as SdSelect<string>;
      select.value.set(select.options()[optionIndex].value);
      await stable();
    };
    const saved = () => questionsOfVersion(record.currentVersionId, mock.db.data);
    return {
      fixture,
      element,
      mock,
      record,
      text,
      button,
      buttons,
      click,
      dialogButton,
      type,
      questionTexts,
      questionText,
      optionInputs,
      chooseCorrect,
      saved,
      toasts: TestBed.inject(ToastService),
    };
  }

  /** Adds a question with text, answers and, unless `correct` is null, a correct answer. */
  async function addQuestion(
    ui: Awaited<ReturnType<typeof render>>,
    text: string,
    answers: string[],
    correct: number | null = 0,
  ) {
    await ui.click('Add question');
    const index = ui.questionTexts().length - 1;
    await ui.type(ui.questionText(index), text);
    for (let i = 2; i < answers.length; i++) {
      ui.buttons('Add answer option')[index].click();
      await ui.fixture.whenStable();
    }
    const inputs = ui.optionInputs(index);
    for (const [i, answer] of answers.entries()) await ui.type(inputs[i], answer);
    if (correct !== null) await ui.chooseCorrect(index, correct);
  }

  it('shows the current version, its questions and answer options, with the correct one marked', async () => {
    const { text, questionTexts, saved, button } = await render('Handling personal data');

    expect(questionTexts()).toEqual(saved().map((q) => q.text));
    expect(text()).toMatch(/Version 1: \d+ questions, \d+ attempts use it\./);
    expect(text()).toContain('Correct');
    expect(button('Save questions')?.disabled).toBe(true);
  });

  it('adds questions to a draft and saves them in place, without a version warning', async () => {
    const ui = await render(DRAFT);
    expect(ui.text()).toContain('No questions yet');
    expect(ui.text()).not.toContain('Saving creates version');

    await addQuestion(ui, 'Who do you report phishing to?', ['IT security', 'Nobody', 'A friend']);
    expect(ui.text()).toContain('Unsaved changes');
    await ui.click('Save questions');

    await vi.waitFor(() => expect(ui.saved()).toHaveLength(1));
    expect(document.querySelector('sd-dialog[open]')).toBeNull();
    const [question] = ui.saved();
    expect(question.text).toBe('Who do you report phishing to?');
    expect(question.answerOptions.map((o) => [o.text, o.isCorrect])).toEqual([
      ['IT security', true],
      ['Nobody', false],
      ['A friend', false],
    ]);
    expect(
      ui.mock.db.data.questionnaireVersions.filter((v) => v.questionnaireId === ui.record.id),
    ).toHaveLength(1);
    expect(ui.toasts.toasts().map((t) => t.heading)).toEqual(['Questions saved']);
    await vi.waitFor(() => expect(ui.text()).not.toContain('Unsaved changes'));
  });

  it('removes and reorders questions with the keyboard-accessible buttons', async () => {
    const ui = await render(DRAFT);
    await addQuestion(ui, 'First', ['A', 'B']);
    await addQuestion(ui, 'Second', ['A', 'B']);
    await addQuestion(ui, 'Third', ['A', 'B']);

    expect(ui.button('Move question 1 up')?.disabled).toBe(true);
    expect(ui.button('Move question 3 down')?.disabled).toBe(true);
    await ui.click('Move question 3 up');
    expect(ui.questionTexts()).toEqual(['First', 'Third', 'Second']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Move question 2 up');
    await ui.click('Move question 1 down');
    expect(ui.questionTexts()).toEqual(['Third', 'First', 'Second']);
    await ui.click('Remove question 3');
    expect(ui.questionTexts()).toEqual(['Third', 'First']);
    expect(ui.text()).toContain('Question 3 removed.');

    await ui.click('Save questions');
    await vi.waitFor(() => expect(ui.saved().map((q) => q.text)).toEqual(['Third', 'First']));
  });

  it('adds, removes and reorders answer options, keeping the correct answer with its option', async () => {
    const ui = await render(DRAFT);
    await addQuestion(ui, 'Pick one', ['Right', 'Wrong', 'Also wrong'], 0);

    await ui.click('Move answer A of question 1 down');
    expect(ui.optionInputs(0).map((i) => i.value)).toEqual(['Wrong', 'Right', 'Also wrong']);
    await ui.click('Remove answer C of question 1');
    expect(ui.optionInputs(0).map((i) => i.value)).toEqual(['Wrong', 'Right']);
    await ui.click('Add answer option');
    await ui.type(ui.optionInputs(0)[2], 'New');

    await ui.click('Save questions');
    await vi.waitFor(() => expect(ui.saved()).toHaveLength(1));
    expect(ui.saved()[0].answerOptions.map((o) => [o.text, o.isCorrect])).toEqual([
      ['Wrong', false],
      ['Right', true],
      ['New', false],
    ]);
  });

  it('keeps exactly one correct answer, and an active questionnaire cannot be saved without one', async () => {
    const ui = await render('Handling personal data');
    const before = structuredClone(ui.saved());
    const count = before.length;
    await addQuestion(ui, 'No answer chosen', ['Yes', 'No'], null);

    await ui.click('Save questions');

    expect(ui.text()).toContain('Some questions need fixing.');
    expect(ui.text()).toContain('Choose the correct answer.');
    expect(document.querySelector('sd-dialog[open]')).toBeNull();
    expect(ui.saved()).toEqual(before);

    // Choosing another answer moves the mark: there is only ever one correct answer.
    await ui.chooseCorrect(count, 0);
    await ui.chooseCorrect(count, 1);
    const marks = ui.element.querySelectorAll('.question')[count].querySelectorAll('sd-badge');
    expect(marks).toHaveLength(1);
    expect(ui.text()).not.toContain('Choose the correct answer.');
  });

  it('flags an empty question and too few answers on an active questionnaire', async () => {
    const ui = await render('Handling personal data');
    const count = ui.questionTexts().length;
    await ui.click('Add question');
    await ui.click(`Remove answer B of question ${count + 1}`);

    await ui.click('Save questions');

    expect(ui.text()).toContain('Enter the question.');
    expect(ui.text()).toContain('Enter the answer.');
    expect(ui.text()).toContain('Add at least 2 answer options. Choose the correct answer.');
  });

  it('lets an inactive draft be saved incomplete', async () => {
    const ui = await render(DRAFT);
    await addQuestion(ui, 'Not finished', ['Only answer'], null);
    await ui.click('Remove answer B of question 1');

    await ui.click('Save questions');

    await vi.waitFor(() => expect(ui.saved()).toHaveLength(1));
    expect(ui.saved()[0].answerOptions.map((o) => o.isCorrect)).toEqual([false]);
  });

  it('warns before saving a version that has attempts, and creates a new version on confirm', async () => {
    const ui = await render(WITH_ATTEMPTS);
    const oldVersionId = ui.record.currentVersionId;
    const oldQuestions = structuredClone(ui.saved());
    expect(ui.text()).toContain('Saving creates version 3');

    await ui.type(ui.questionText(0), 'An edited first question?');
    await ui.click('Save questions');
    expect(document.querySelector('sd-dialog')?.textContent).toContain('Save as version 3?');
    expect(ui.text()).toContain('Past attempts and results are kept and do not change.');

    // Cancel saves nothing and keeps the edit.
    await ui.dialogButton('Cancel');
    expect(ui.record.currentVersionId).toBe(oldVersionId);
    expect(ui.questionTexts()[0]).toBe('An edited first question?');

    await ui.click('Save questions');
    await ui.dialogButton('Save as version 3');

    await vi.waitFor(() => expect(ui.record.currentVersionId).not.toBe(oldVersionId));
    expect(questionsOfVersion(oldVersionId, ui.mock.db.data)).toEqual(oldQuestions);
    expect(ui.saved()[0].text).toBe('An edited first question?');
    expect(ui.toasts.toasts().map((t) => t.heading)).toEqual(['Version 3 created']);
    await vi.waitFor(() => expect(ui.text()).toContain('Version 3:'));
    expect(ui.text()).toContain('no attempts yet');
    expect(ui.text()).not.toContain('Saving creates version');
  });

  it('asks before leaving with unsaved changes, through the route guard', async () => {
    const ui = await render(DRAFT);
    const editor = ui.fixture.componentInstance;
    const guard = (component: QuestionEditor) =>
      TestBed.runInInjectionContext(() =>
        unsavedChangesGuard(component, null as never, null as never, null as never),
      );

    expect(guard(editor)).toBe(true);

    await addQuestion(ui, 'Unsaved', ['A', 'B']);
    const stay = guard(editor) as Promise<boolean>;
    await ui.fixture.whenStable();
    expect(document.querySelector('sd-dialog')?.textContent).toContain('Leave without saving?');
    await ui.dialogButton('Keep editing');
    await expect(stay).resolves.toBe(false);
    expect(ui.questionTexts()).toEqual(['Unsaved']);

    const leave = guard(editor) as Promise<boolean>;
    await ui.fixture.whenStable();
    await ui.dialogButton('Leave without saving');
    await expect(leave).resolves.toBe(true);
  });

  it('warns before the browser tab closes with unsaved changes', async () => {
    const ui = await render(DRAFT);
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(unload()).toBe(false);
    await addQuestion(ui, 'Unsaved', ['A', 'B']);
    expect(unload()).toBe(true);
  });

  it('discards the changes after a confirmation', async () => {
    const ui = await render('Handling personal data');
    const original = ui.questionTexts();

    await ui.type(ui.questionText(0), 'Changed');
    await ui.click('Discard changes');
    await ui.dialogButton('Discard changes');

    expect(ui.questionTexts()).toEqual(original);
    expect(ui.button('Save questions')?.disabled).toBe(true);
  });

  it('shows the no-access state on 403, and an error with Try again when loading fails', async () => {
    const denied = await render(DRAFT, { flags: { errorStatus: 403 } });
    expect(denied.element.querySelector('app-access-denied')).not.toBeNull();
    TestBed.resetTestingModule();

    const failed = await render(DRAFT, { flags: { errorStatus: 500 } });
    expect(failed.text()).toContain('Could not load the questions');
    expect(failed.button('Try again')).toBeDefined();
  });
});
