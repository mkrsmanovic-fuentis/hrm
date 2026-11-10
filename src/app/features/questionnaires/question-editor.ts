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
import { saveFailedMessage } from '../../shared/forms/form-errors';
import {
  draftErrors,
  type DraftQuestion,
  emptyOption,
  emptyQuestion,
  moveItem,
  optionLetter,
  sameQuestions,
  toDraft,
  toInput,
} from './question-draft';
import { questionCountText } from './questionnaire-text';

/** Which confirmation is open. */
type Confirmation = 'new-version' | 'leave' | 'discard';

/**
 * The question editor in the questionnaire page's "Questions" section.
 *
 * It edits a working copy of the current version's questions: add, edit, remove and reorder
 * questions and their answer options, pick the one correct answer, and add feedback for a wrong
 * answer. **Save questions** sends the whole ordered list at once with
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
  protected readonly questions = linkedSignal(() => this.savedQuestions());

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
  /** An active questionnaire must stay complete when it is saved. */
  private readonly mustBeComplete = computed(() => this.questionnaire().status === 'active');

  protected readonly saving = signal(false);
  /** Set by the first save attempt, so errors show only once the user tries to save. */
  private readonly showErrors = signal(false);
  private readonly clientErrors = computed(() =>
    draftErrors(this.questions(), this.mustBeComplete()),
  );
  /** Errors from the last failed save, by the API's field names. Cleared by the next edit. */
  private readonly serverErrors = signal<Record<string, string>>({});
  /** Why the last save failed, when the API named no field of the editor. */
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

  /** The error to show for a field, by the API's field name. */
  protected errorFor(field: string): string | null {
    return (
      this.serverErrors()[field] ?? (this.showErrors() ? this.clientErrors()[field] : null) ?? null
    );
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

  protected setQuestionText(index: number, event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.updateQuestion(index, (question) => ({ ...question, text }));
  }

  protected setExplanation(index: number, event: Event): void {
    const explanation = (event.target as HTMLTextAreaElement).value;
    this.updateQuestion(index, (question) => ({ ...question, explanation }));
  }

  protected addOption(index: number): void {
    const option = emptyOption();
    this.updateQuestion(index, (question) => ({
      ...question,
      answerOptions: [...question.answerOptions, option],
    }));
    this.focus(`[data-option-text="${option.key}"]`);
  }

  protected removeOption(index: number, optionIndex: number): void {
    const options = this.questions()[index].answerOptions;
    this.updateQuestion(index, (question) => ({
      ...question,
      answerOptions: question.answerOptions.filter((_, i) => i !== optionIndex),
    }));
    this.announce(`Answer ${optionLetter(optionIndex)} of question ${index + 1} removed.`);
    const next = options[optionIndex + 1] ?? options[optionIndex - 1];
    this.focus(
      next
        ? `[data-option-text="${next.key}"]`
        : `[data-add-option="${this.questions()[index].key}"]`,
    );
  }

  protected moveOption(index: number, optionIndex: number, by: -1 | 1): void {
    const options = this.questions()[index].answerOptions;
    const to = optionIndex + by;
    if (to < 0 || to >= options.length) return;
    const key = options[optionIndex].key;
    this.updateQuestion(index, (question) => ({
      ...question,
      answerOptions: moveItem(question.answerOptions, optionIndex, to),
    }));
    this.announce(
      `Answer ${optionLetter(optionIndex)} of question ${index + 1} moved to ${optionLetter(to)}.`,
    );
    this.focusMoveButton(`option-${key}`, by, to, options.length);
  }

  protected setOptionText(index: number, optionIndex: number, event: Event): void {
    const text = (event.target as HTMLInputElement).value;
    this.updateQuestion(index, (question) => ({
      ...question,
      answerOptions: question.answerOptions.map((option, i) =>
        i === optionIndex ? { ...option, text } : option,
      ),
    }));
  }

  /** Marks one answer option correct, and every other one of the question not correct. */
  protected setCorrect(index: number, key: string | null): void {
    this.updateQuestion(index, (question) => ({
      ...question,
      answerOptions: question.answerOptions.map((option) => ({
        ...option,
        isCorrect: option.key === key,
      })),
    }));
  }

  private updateQuestion(index: number, change: (question: DraftQuestion) => DraftQuestion): void {
    this.edit((questions) => questions.map((q, i) => (i === index ? change(q) : q)));
  }

  /** Every edit goes through here: it clears the errors of the last failed save. */
  private edit(change: (questions: DraftQuestion[]) => DraftQuestion[]): void {
    this.questions.update(change);
    if (Object.keys(this.serverErrors()).length > 0) this.serverErrors.set({});
    this.formError.set(null);
  }

  // ---------------------------------------------------------------- saving

  /** Checks the working copy, then saves, after the new-version confirmation when one is due. */
  protected requestSave(): void {
    if (this.saving() || !this.dirty()) return;
    this.showErrors.set(true);
    this.formError.set(null);
    if (Object.keys(this.clientErrors()).length > 0) {
      this.formError.set('Some questions need fixing. Check the highlighted fields, then save.');
      this.focus('[aria-invalid="true"]');
      return;
    }
    if (this.createsVersion()) {
      this.confirmError.set(null);
      this.confirmation.set('new-version');
      return;
    }
    void this.save();
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
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
      this.showErrors.set(false);
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
    } catch (error) {
      this.onSaveFailed(error);
    } finally {
      this.saving.set(false);
    }
  }

  private onSaveFailed(error: unknown): void {
    const fieldErrors =
      error instanceof ApiError && error.isValidation
        ? error.fieldErrors.filter((e) => e.location === 'body')
        : [];
    if (fieldErrors.length > 0) {
      const errors: Record<string, string> = {};
      for (const fieldError of fieldErrors) {
        errors[fieldError.field] = errors[fieldError.field]
          ? `${errors[fieldError.field]} ${fieldError.message}`
          : fieldError.message;
      }
      this.serverErrors.set(errors);
      this.confirmation.set(null);
      this.formError.set(
        errors['questions'] ??
          'Some questions need fixing. Check the highlighted fields, then save.',
      );
      this.focus('[aria-invalid="true"]');
      return;
    }
    const message = saveFailedMessage(error);
    if (this.confirmation() === 'new-version') this.confirmError.set(message);
    else this.formError.set(message);
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
        void this.save();
        return;
      case 'leave':
        this.decideLeave(true);
        this.confirmation.set(null);
        return;
      case 'discard':
        this.questions.set(this.savedQuestions());
        this.serverErrors.set({});
        this.formError.set(null);
        this.showErrors.set(false);
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
