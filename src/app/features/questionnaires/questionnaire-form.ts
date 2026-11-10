import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  type OnInit,
  output,
  signal,
} from '@angular/core';
import { disabled, form, FormField, required, submit, validate } from '@angular/forms/signals';
import {
  SdButton,
  SdCallout,
  SdDrawer,
  SdField,
  SdInput,
  SdSelect,
  type SdSelectOption,
} from '@specora-dev/ui-kit';
import { firstValueFrom } from 'rxjs';
import {
  ApiClient,
  type Questionnaire,
  type QuestionnaireCreate,
  type QuestionnaireUpdate,
  type Topic,
} from '../../core/api';
import { saveFailedMessage, serverFieldErrors, visibleError } from '../../shared/forms/form-errors';

/** Limits from the API spec (`QuestionnaireCreate`, `PassingScore`, `TimeLimitMinutes`). */
const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;
const PASSING_SCORE_MIN = 1;
const PASSING_SCORE_MAX = 100;
const DEFAULT_PASSING_SCORE = 80;
const TIME_LIMIT_MIN = 1;
const TIME_LIMIT_MAX = 480;

interface QuestionnaireModel {
  title: string;
  description: string;
  topicId: string | null;
  passingScore: number | null;
  timeLimitMinutes: number | null;
}

/**
 * Creates a questionnaire, or edits its settings, in a drawer. The parent adds it with `@if`
 * when the drawer should open, and removes it on `closed`. On success it emits `saved` with the
 * saved record and closes itself.
 *
 * Settings only: title, description, topic, passing score and time limit. A new questionnaire
 * starts inactive; status changes go through the status dialog. Questions are edited elsewhere.
 *
 * Follows the Departments form; see "Admin list and form pattern" in the developer guide.
 */
@Component({
  selector: 'app-questionnaire-form',
  imports: [FormField, SdButton, SdCallout, SdDrawer, SdField, SdInput, SdSelect],
  templateUrl: './questionnaire-form.html',
  styleUrl: './questionnaire-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionnaireForm implements OnInit {
  private readonly api = inject(ApiClient);

  /** The questionnaire to edit, or null to create one. */
  readonly questionnaire = input<Questionnaire | null>(null);
  /** Every topic, active and inactive. Only active ones can be chosen. */
  readonly topics = input.required<readonly Topic[]>();
  /** Fires after a successful save, with the saved record. */
  readonly saved = output<Questionnaire>();
  /** Fires once the drawer has closed, after a save or a cancel. */
  readonly closed = output();

  protected readonly open = signal(true);
  protected readonly saving = signal(false);
  /** Why the last save failed, when the API named no field. */
  protected readonly formError = signal<string | null>(null);

  protected readonly isNew = computed(() => this.questionnaire() === null);
  protected readonly heading = computed(() =>
    this.isNew() ? 'New questionnaire' : 'Edit settings',
  );

  /**
   * Active topics can be chosen. Inactive ones are listed but disabled, except the topic an
   * existing questionnaire is already in: it may stay there.
   */
  protected readonly topicOptions = computed<SdSelectOption<string>[]>(() => {
    const current = this.questionnaire()?.topicId;
    return [...this.topics()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((topic) => {
        if (topic.status === 'active') return { value: topic.id, label: topic.name };
        const stays = topic.id === current;
        return {
          value: topic.id,
          label: topic.name,
          description: stays
            ? 'Inactive. The questionnaire can stay here.'
            : 'Inactive. Choose an active topic.',
          disabled: !stays,
        };
      });
  });

  protected readonly model = signal<QuestionnaireModel>({
    title: '',
    description: '',
    topicId: null,
    passingScore: DEFAULT_PASSING_SCORE,
    timeLimitMinutes: null,
  });
  protected readonly f = form(this.model, (p) => {
    // The API trims text before it checks it, so the form does too.
    required(p.title, { message: 'Enter a title.' });
    validate(p.title, ({ value }) => checkText(value(), TITLE_MAX_LENGTH, 'Enter a title.'));
    validate(p.description, ({ value }) => checkText(value(), DESCRIPTION_MAX_LENGTH));
    required(p.topicId, { message: 'Choose a topic.' });
    required(p.passingScore, {
      message: `Enter a whole number from ${PASSING_SCORE_MIN} to ${PASSING_SCORE_MAX}.`,
    });
    validate(p.passingScore, ({ value }) =>
      checkWholeNumber(value(), PASSING_SCORE_MIN, PASSING_SCORE_MAX),
    );
    validate(p.timeLimitMinutes, ({ value }) =>
      checkWholeNumber(value(), TIME_LIMIT_MIN, TIME_LIMIT_MAX),
    );
    disabled(p.title, () => this.saving());
    disabled(p.description, () => this.saving());
    disabled(p.topicId, () => this.saving());
    disabled(p.passingScore, () => this.saving());
    disabled(p.timeLimitMinutes, () => this.saving());
  });

  protected readonly visibleError = visibleError;

  ngOnInit(): void {
    const questionnaire = this.questionnaire();
    if (questionnaire) {
      this.model.set({
        title: questionnaire.title,
        description: questionnaire.description ?? '',
        topicId: questionnaire.topicId,
        passingScore: questionnaire.passingScore,
        timeLimitMinutes: questionnaire.timeLimitMinutes,
      });
    }
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    this.formError.set(null);
    await submit(this.f, async (form) => {
      this.saving.set(true);
      try {
        const body = this.changes();
        // Nothing changed in an edit: close without a request or a "saved" toast.
        if (body !== null) this.saved.emit(await this.send(body));
        this.open.set(false);
        return undefined;
      } catch (error) {
        const fieldErrors = serverFieldErrors(error, {
          title: form.title,
          description: form.description,
          topicId: form.topicId,
          passingScore: form.passingScore,
          timeLimitMinutes: form.timeLimitMinutes,
        });
        if (fieldErrors) return fieldErrors;
        this.formError.set(saveFailedMessage(error));
        return undefined;
      } finally {
        this.saving.set(false);
      }
    });
  }

  /**
   * The request body: every field for a new questionnaire, only the changed fields for an edit,
   * or `null` when an edit changes nothing. Text is trimmed and an empty description is `null`,
   * as the API does.
   */
  private changes(): QuestionnaireUpdate | null {
    const model = this.model();
    const description = model.description.trim();
    const values = {
      title: model.title.trim(),
      description: description === '' ? null : description,
      // Checked by the form: a topic and a passing score are set when it is valid.
      topicId: model.topicId!,
      passingScore: model.passingScore!,
      timeLimitMinutes: model.timeLimitMinutes,
    };
    const questionnaire = this.questionnaire();
    if (!questionnaire) return values;
    const changed: QuestionnaireUpdate = {
      ...(values.title !== questionnaire.title && { title: values.title }),
      ...(values.description !== questionnaire.description && {
        description: values.description,
      }),
      ...(values.topicId !== questionnaire.topicId && { topicId: values.topicId }),
      ...(values.passingScore !== questionnaire.passingScore && {
        passingScore: values.passingScore,
      }),
      ...(values.timeLimitMinutes !== questionnaire.timeLimitMinutes && {
        timeLimitMinutes: values.timeLimitMinutes,
      }),
    };
    return Object.keys(changed).length > 0 ? changed : null;
  }

  private send(body: QuestionnaireUpdate): Promise<Questionnaire> {
    const questionnaire = this.questionnaire();
    return firstValueFrom(
      questionnaire
        ? this.api.patch('/questionnaires/{questionnaireId}', {
            path: { questionnaireId: questionnaire.id },
            body,
          })
        : this.api.post('/questionnaires', { body: body as QuestionnaireCreate }),
    );
  }
}

/**
 * A text field, checked after trimming: longer than `max`, or, when `blankMessage` is given
 * (a required field), only spaces.
 */
function checkText(value: string, max: number, blankMessage?: string) {
  const trimmed = value.trim();
  if (blankMessage && value !== '' && trimmed === '') {
    return { kind: 'blank', message: blankMessage };
  }
  if (trimmed.length > max) {
    return { kind: 'maxLength', message: `Use ${max} characters or fewer.` };
  }
  return undefined;
}

/** A number field: when set, a whole number from `min` to `max`. */
function checkWholeNumber(value: number | null, min: number, max: number) {
  if (value === null) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    return { kind: 'range', message: `Enter a whole number from ${min} to ${max}.` };
  }
  return undefined;
}
