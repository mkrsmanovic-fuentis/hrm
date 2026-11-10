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
  SdIcon,
  SdInput,
  SdSelect,
} from '@specora-dev/ui-kit';
import { firstValueFrom } from 'rxjs';
import {
  ApiClient,
  type Topic,
  type TopicCreate,
  type TopicIcon,
  type TopicUpdate,
} from '../../core/api';
import { saveFailedMessage, serverFieldErrors, visibleError } from '../../shared/forms/form-errors';
import { TOPIC_ICON_OPTIONS, TOPIC_ICONS, topicIcon } from './topic-icons';

/** Limits from the API spec (`TopicCreate`). */
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 1000;

interface TopicModel {
  name: string;
  description: string;
  icon: TopicIcon | null;
}

/**
 * Creates a topic, or edits one, in a drawer. The parent adds it with `@if` when the drawer
 * should open, and removes it on `closed`. On success it emits `saved` with the saved record and
 * closes itself.
 *
 * Follows the Departments form; see "Admin list and form pattern" in the developer guide.
 */
@Component({
  selector: 'app-topic-form',
  imports: [FormField, SdButton, SdCallout, SdDrawer, SdField, SdIcon, SdInput, SdSelect],
  templateUrl: './topic-form.html',
  styleUrl: './topic-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopicForm implements OnInit {
  private readonly api = inject(ApiClient);

  /** The topic to edit, or null to create one. */
  readonly topic = input<Topic | null>(null);
  /** Fires after a successful save, with the saved record. */
  readonly saved = output<Topic>();
  /** Fires once the drawer has closed, after a save or a cancel. */
  readonly closed = output();

  protected readonly open = signal(true);
  protected readonly saving = signal(false);
  /** Why the last save failed, when the API named no field. */
  protected readonly formError = signal<string | null>(null);

  protected readonly isNew = computed(() => this.topic() === null);
  protected readonly heading = computed(() => (this.isNew() ? 'New topic' : 'Edit topic'));

  protected readonly iconOptions = TOPIC_ICON_OPTIONS;

  protected readonly model = signal<TopicModel>({ name: '', description: '', icon: null });
  protected readonly f = form(this.model, (p) => {
    // The API trims text before it checks it, so the form does too.
    required(p.name, { message: 'Enter a name.' });
    validate(p.name, ({ value }) => checkText(value(), NAME_MAX_LENGTH, 'Enter a name.'));
    required(p.description, { message: 'Enter a description.' });
    validate(p.description, ({ value }) =>
      checkText(value(), DESCRIPTION_MAX_LENGTH, 'Enter a description.'),
    );
    disabled(p.name, () => this.saving());
    disabled(p.description, () => this.saving());
    disabled(p.icon, () => this.saving());
  });

  /** The chosen icon, previewed under the picker. */
  protected readonly preview = computed(() => {
    const name = this.model().icon;
    return name ? { icon: topicIcon(name)!, label: TOPIC_ICONS[name].label } : null;
  });

  protected readonly visibleError = visibleError;

  ngOnInit(): void {
    const topic = this.topic();
    if (topic) {
      this.model.set({ name: topic.name, description: topic.description, icon: topic.icon });
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
          name: form.name,
          description: form.description,
          icon: form.icon,
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
   * The request body: every field for a new topic, only the changed fields for an edit, or `null`
   * when an edit changes nothing. Text is trimmed, as the API does.
   */
  private changes(): TopicUpdate | null {
    const { name, description, icon } = this.model();
    const values = { name: name.trim(), description: description.trim(), icon };
    const topic = this.topic();
    if (!topic) return values;
    const changed: TopicUpdate = {
      ...(values.name !== topic.name && { name: values.name }),
      ...(values.description !== topic.description && { description: values.description }),
      ...(values.icon !== topic.icon && { icon: values.icon }),
    };
    return Object.keys(changed).length > 0 ? changed : null;
  }

  private send(body: TopicUpdate): Promise<Topic> {
    const topic = this.topic();
    return firstValueFrom(
      topic
        ? this.api.patch('/topics/{topicId}', { path: { topicId: topic.id }, body })
        : this.api.post('/topics', { body: body as TopicCreate }),
    );
  }
}

/** A required text field, checked after trimming: blank, or longer than `max`. */
function checkText(value: string, max: number, blankMessage: string) {
  const trimmed = value.trim();
  if (value !== '' && trimmed === '') return { kind: 'blank', message: blankMessage };
  if (trimmed.length > max)
    return { kind: 'maxLength', message: `Use ${max} characters or fewer.` };
  return undefined;
}
