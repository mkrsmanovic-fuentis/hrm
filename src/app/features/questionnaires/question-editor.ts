import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import {
  applyEach,
  disabled,
  type FieldTree,
  form,
  FormField,
  submit,
  validate,
  type ValidationError,
} from '@angular/forms/signals';
import {
  LucideArrowDown,
  LucideArrowUp,
  LucideListChecks,
  LucidePlus,
  LucideSave,
  LucideTrash2,
} from '@lucide/angular';
import {
  SdBadge,
  SdButton,
  SdCallout,
  SdEmptyState,
  SdField,
  SdInput,
  SdPanel,
  SdPanelSection,
  SdSelect,
  SdSkeleton,
  type SdSelectOption,
} from '@specora-dev/ui-kit';
import { firstValueFrom } from 'rxjs';
import { AccessDenied } from '../../core/access';
import { ApiClient, ApiError, type Questionnaire, type QuestionnaireVersion } from '../../core/api';
import { ToastService } from '../../core/toast';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { saveFailedMessage, serverFieldErrors, visibleError } from '../../shared/forms/form-errors';
import { textRules } from '../../shared/forms/text-rules';
import {
  completenessProblem,
  type DraftQuestion,
  emptyOption,
  emptyQuestion,
  EXPLANATION_MAX_LENGTH,
  moveItem,
  OPTION_TEXT_MAX_LENGTH,
  optionLetter,
  QUESTION_TEXT_MAX_LENGTH,
  sameQuestions,
  toDraft,
  toInput,
} from './question-draft';
import { questionCountText } from './questionnaire-text';

/** Which confirmation is open. */
type Confirmation = 'new-version' | 'leave' | 'discard';

/** The working copy, as a signal form. */
interface EditorModel {
  questions: DraftQuestion[];
}

const FIX_FIELDS = 'Some questions need fixing. Check the highlighted fields, then save.';

/**
 * The question editor in the questionnaire page's "Questions" section.
 *
 * It edits a working copy of the current version's questions, a signal form: add, edit, remove
 * and reorder questions and their answer options, pick the one correct answer, and add feedback
 * for a wrong answer. **Save questions** sends the whole ordered list at once with
 * `PUT /questionnaires/{questionnaireId}/questions`.
 *
 * - While no attempt uses the current version, the save replaces its questions in place.
 * - Once attempts use it, the save creates a new version. The editor says so before saving, in a
 *   confirmation.
 * - An active questionnaire must stay complete; an inactive draft may be saved incomplete.
 *
 * The page asks `confirmLeave()` before the router leaves it, and the editor warns before the
 * browser tab closes or reloads while there are unsaved changes.
 */
@Component({
  selector: 'app-question-editor',
  imports: [
    AccessDenied,
    ConfirmDialog,
    FormField,
    SdBadge,
    SdButton,
    SdCallout,
    SdEmptyState,
    SdField,
    SdInput,
    SdPanel,
    SdPanelSection,
    SdSelect,
    SdSkeleton,
  ],
  templateUrl: './question-editor.html',
  styleUrl: './question-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class QuestionEditor {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The questionnaire whose questions are edited. Its status decides whether it must be complete. */
  readonly questionnaire = input.required<Questionnaire>();
  /** Fires after a save that changed the questions, with the current version. */
  readonly saved = output<QuestionnaireVersion>();

  protected readonly icons = {
    add: LucidePlus,
    down: LucideArrowDown,
    empty: LucideListChecks,
    remove: LucideTrash2,
    save: LucideSave,
    up: LucideArrowUp,
  };
  protected readonly letter = optionLetter;
  protected readonly visibleError = visibleError;

  /** Only the ID: reloading the questionnaire after a settings change keeps the working copy. */
  private readonly questionnaireId = computed(() => this.questionnaire().id);

  protected readonly loaded = rxResource({
    params: () => ({ questionnaireId: this.questionnaireId() }),
    stream: ({ params }) =>
      this.api.get('/questionnaires/{questionnaireId}/questions', { path: params }),
  });

  /** The saved version: as loaded, then as the last save returned it. */
  protected readonly version = linkedSignal<QuestionnaireVersion | null>(() =>
    this.loaded.hasValue() ? this.loaded.value() : null,
  );
  /** The saved questions, as a working copy, to compare against. */
  private readonly savedQuestions = computed(() => {
    const version = this.version();
    return version ? toDraft(version) : [];
  });

  /** The working copy. It starts from the saved questions and is reset by every save. */
  protected readonly model = linkedSignal<EditorModel>(() => ({
    questions: this.savedQuestions(),
  }));
  protected readonly questions = computed(() => this.model().questions);

  protected readonly saving = signal(false);
  /** An active questionnaire must stay complete when it is saved. */
  private readonly mustBeComplete = computed(() => this.questionnaire().status === 'active');

  /** The same rules as the API. Text is trimmed before it is checked, as the API does. */
  protected readonly f = form(this.model, (p) => {
    validate(p.questions, ({ value }) =>
      this.mustBeComplete() && value().length === 0
        ? { kind: 'required', message: 'Add at least one question.' }
        : undefined,
    );
    applyEach(p.questions, (question) => {
      textRules(question.text, {
        required: 'Enter the question.',
        maxLength: QUESTION_TEXT_MAX_LENGTH,
      });
      textRules(question.explanation, { maxLength: EXPLANATION_MAX_LENGTH });
      validate(question, ({ value }) => {
        const problem = this.mustBeComplete() ? completenessProblem(value()) : null;
        return problem ? { kind: 'incomplete', message: problem } : undefined;
      });
      applyEach(question.answerOptions, (option) => {
        textRules(option.text, {
          required: 'Enter the answer.',
          maxLength: OPTION_TEXT_MAX_LENGTH,
        });
      });
    });
    disabled(p.questions, () => this.saving());
  });

  protected readonly loadError = computed(() => {
    const error = this.loaded.error();
    return error instanceof ApiError ? error : null;
  });
  protected readonly firstLoad = computed(() => this.loaded.isLoading() && !this.version());

  protected readonly dirty = computed(
    () => this.version() !== null && !sameQuestions(this.questions(), this.savedQuestions()),
  );
  /** Attempts use the saved version, so saving creates the next one. */
  protected readonly createsVersion = computed(() => (this.version()?.attemptCount ?? 0) > 0);
  protected readonly nextVersionNumber = computed(() => (this.version()?.versionNumber ?? 0) + 1);

  /** Why the last save failed, when no field can show it. */
  protected readonly formError = signal<string | null>(null);
  /** Spoken to screen readers after a move or removal. */
  protected readonly announcement = signal('');

  protected readonly confirmation = signal<Confirmation | null>(null);
  protected readonly confirmError = signal<string | null>(null);
  private leaveDecision: ((leave: boolean) => void) | null = null;

  protected readonly summary = computed(() => {
    const version = this.version();
    if (!version) return '';
    const count = questionCountText(version.questions.length);
    const attempts = version.attemptCount;
    const used =
      attempts === 0
        ? 'no attempts yet'
        : attempts === 1
          ? '1 attempt uses it'
          : `${attempts} attempts use it`;
    return `Version ${version.versionNumber}: ${count}, ${used}.`;
  });

  /** The options of the "Correct answer" select, for each question. */
  protected correctOptions(question: DraftQuestion): SdSelectOption<string>[] {
    return question.answerOptions.map((option, index) => ({
      value: option.key,
      label: `${optionLetter(index)}. ${option.text.trim() || 'No text yet'}`,
    }));
  }

  protected correctKey(question: DraftQuestion): string | null {
    return question.answerOptions.find((option) => option.isCorrect)?.key ?? null;
  }

  // ---------------------------------------------------------------- editing

  protected addQuestion(): void {
    const question = emptyQuestion();
    this.edit((questions) => [...questions, question]);
    this.focus(`[data-question-text="${question.key}"]`);
  }

  protected removeQuestion(index: number): void {
    const questions = this.questions();
    this.edit((list) => list.filter((_, i) => i !== index));
    this.announce(`Question ${index + 1} removed.`);
    // Focus the question that took its place, the one before it, or the Add question button.
    const next = questions[index + 1] ?? questions[index - 1];
    this.focus(next ? `[data-question-text="${next.key}"]` : '[data-add-question]');
  }

  protected moveQuestion(index: number, by: -1 | 1): void {
    const to = index + by;
    const questions = this.questions();
    if (to < 0 || to >= questions.length) return;
    const key = questions[index].key;
    this.edit((list) => moveItem(list, index, to));
    this.announce(`Question ${index + 1} moved to position ${to + 1}.`);
    this.focusMoveButton(`question-${key}`, by, to, questions.length);
  }

  protected addOption(index: number): void {
    const option = emptyOption();
    this.updateOptions(index, (options) => [...options, option]);
    this.focus(`[data-option-text="${option.key}"]`);
  }

  protected removeOption(index: number, optionIndex: number): void {
    const question = this.questions()[index];
    const options = question.answerOptions;
    this.updateOptions(index, (list) => list.filter((_, i) => i !== optionIndex));
    this.announce(`Answer ${optionLetter(optionIndex)} of question ${index + 1} removed.`);
    const next = options[optionIndex + 1] ?? options[optionIndex - 1];
    this.focus(next ? `[data-option-text="${next.key}"]` : `[data-add-option="${question.key}"]`);
  }

  protected moveOption(index: number, optionIndex: number, by: -1 | 1): void {
    const options = this.questions()[index].answerOptions;
    const to = optionIndex + by;
    if (to < 0 || to >= options.length) return;
    const key = options[optionIndex].key;
    this.updateOptions(index, (list) => moveItem(list, optionIndex, to));
    this.announce(
      `Answer ${optionLetter(optionIndex)} of question ${index + 1} moved to ${optionLetter(to)}.`,
    );
    this.focusMoveButton(`option-${key}`, by, to, options.length);
  }

  /** Marks one answer option correct, and every other one of the question not correct. */
  protected setCorrect(index: number, key: string | null): void {
    const options = this.f.questions[index].answerOptions;
    this.questions()[index].answerOptions.forEach((option, i) =>
      options[i].isCorrect().value.set(option.key === key),
    );
    this.formError.set(null);
  }

  /** Changes the list of answer options of one question. Text edits go through the form. */
  private updateOptions(
    index: number,
    change: (options: DraftQuestion['answerOptions']) => DraftQuestion['answerOptions'],
  ): void {
    const field = this.f.questions[index].answerOptions;
    field().value.update(change);
    this.formError.set(null);
  }

  /** Changes the list of questions. Text edits go through the form. */
  private edit(change: (questions: DraftQuestion[]) => DraftQuestion[]): void {
    this.f.questions().value.update(change);
    this.formError.set(null);
  }

  // ---------------------------------------------------------------- saving

  /** Checks the working copy, then saves, after the new-version confirmation when one is due. */
  protected async requestSave(): Promise<void> {
    if (this.saving() || !this.dirty()) return;
    this.formError.set(null);
    await submit(this.f, async () => {
      if (!this.createsVersion()) return this.send();
      this.confirmError.set(null);
      this.confirmation.set('new-version');
      return undefined;
    });
    this.showInvalid();
  }

  /** The new-version confirmation was accepted. */
  private async saveNewVersion(): Promise<void> {
    await submit(this.f, () => this.send());
    this.showInvalid();
  }

  /** Sends the working copy. Returns the API's field errors for `submit()` to show. */
  private async send(): Promise<ValidationError.WithOptionalFieldTree[] | undefined> {
    this.saving.set(true);
    this.confirmError.set(null);
    const before = this.version();
    try {
      const version = await firstValueFrom(
        this.api.put('/questionnaires/{questionnaireId}/questions', {
          path: { questionnaireId: this.questionnaireId() },
          body: { questions: toInput(this.questions()) },
        }),
      );
      this.version.set(version);
      this.confirmation.set(null);
      if (before && version.id !== before.id) {
        this.toasts.success(
          `Version ${version.versionNumber} created`,
          `Your questions are saved. Results of version ${before.versionNumber} are kept.`,
        );
      } else {
        this.toasts.success('Questions saved', `${this.questionnaire().title} is up to date.`);
      }
      this.saved.emit(version);
      return undefined;
    } catch (error) {
      const fieldErrors = serverFieldErrors(error, this.fieldsByApiName());
      if (fieldErrors) {
        this.confirmation.set(null);
        return fieldErrors;
      }
      const message = saveFailedMessage(error);
      if (this.confirmation() === 'new-version') this.confirmError.set(message);
      else this.formError.set(message);
      return undefined;
    } finally {
      this.saving.set(false);
    }
  }

  /** After a save attempt with invalid fields: say so, and focus the first one. */
  private showInvalid(): void {
    if (!this.f().invalid()) return;
    this.formError.set(visibleError(this.f.questions) ?? FIX_FIELDS);
    this.focus('[aria-invalid="true"]');
  }

  /**
   * The form's fields by the API's field names, such as `questions[2].answerOptions[0].text`, so
   * the errors of a `422` land on their fields.
   */
  private fieldsByApiName(): Record<string, FieldTree<unknown>> {
    const fields: Record<string, FieldTree<unknown>> = { questions: this.f.questions };
    this.questions().forEach((question, i) => {
      const field = this.f.questions[i];
      const path = `questions[${i}]`;
      fields[`${path}.text`] = field.text;
      fields[`${path}.explanation`] = field.explanation;
      fields[`${path}.answerOptions`] = field;
      question.answerOptions.forEach((_, j) => {
        fields[`${path}.answerOptions[${j}].text`] = field.answerOptions[j].text;
      });
    });
    return fields;
  }

  // ---------------------------------------------------------------- leaving and discarding

  /** For the route guard: resolves `true` when the page may be left. */
  confirmLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    this.leaveDecision?.(false);
    this.confirmation.set('leave');
    return new Promise<boolean>((resolve) => (this.leaveDecision = resolve));
  }

  protected requestDiscard(): void {
    if (this.dirty() && !this.saving()) this.confirmation.set('discard');
  }

  protected onConfirmed(): void {
    switch (this.confirmation()) {
      case 'new-version':
        void this.saveNewVersion();
        return;
      case 'leave':
        this.decideLeave(true);
        this.confirmation.set(null);
        return;
      case 'discard':
        this.model.set({ questions: this.savedQuestions() });
        this.f().reset();
        this.formError.set(null);
        this.confirmation.set(null);
        this.announce('Changes discarded.');
        return;
    }
  }

  /** The dialog closed: confirmed, cancelled or dismissed. Staying is the default. */
  protected onConfirmClosed(): void {
    this.decideLeave(false);
    this.confirmation.set(null);
    this.confirmError.set(null);
  }

  private decideLeave(leave: boolean): void {
    const decide = this.leaveDecision;
    this.leaveDecision = null;
    decide?.(leave);
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  // ---------------------------------------------------------------- focus

  private announce(message: string): void {
    this.announcement.set(message);
  }

  /** Focuses the first element matching `selector` after the next render. */
  private focus(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }

  /**
   * Keeps focus on the moved item's move button, so the item can be moved again with the
   * keyboard. At the top or bottom, that button is disabled, so the other one gets focus.
   */
  private focusMoveButton(item: string, by: -1 | 1, to: number, length: number): void {
    const atEnd = by === -1 ? to === 0 : to === length - 1;
    const direction = (by === -1) !== atEnd ? 'up' : 'down';
    this.focus(`[data-move="${item}-${direction}"]`);
  }
}
