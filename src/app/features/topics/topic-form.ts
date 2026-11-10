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
import {
  disabled,
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
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
import { ApiClient, type Topic, type TopicIcon } from '../../core/api';
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
    required(p.name, { message: 'Enter a name.' });
    validate(p.name, ({ value }) =>
      value() !== '' && value().trim() === ''
        ? { kind: 'blank', message: 'Enter a name.' }
        : undefined,
    );
    maxLength(p.name, NAME_MAX_LENGTH, {
      message: `Use ${NAME_MAX_LENGTH} characters or fewer.`,
    });
    required(p.description, { message: 'Enter a description.' });
    validate(p.description, ({ value }) =>
      value() !== '' && value().trim() === ''
        ? { kind: 'blank', message: 'Enter a description.' }
        : undefined,
    );
    maxLength(p.description, DESCRIPTION_MAX_LENGTH, {
      message: `Use ${DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    });
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
        const topic = await this.send();
        this.saved.emit(topic);
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

  private send(): Promise<Topic> {
    const { name, description, icon } = this.model();
    const body = { name: name.trim(), description: description.trim(), icon };
    const topic = this.topic();
    return firstValueFrom(
      topic
        ? this.api.patch('/topics/{topicId}', { path: { topicId: topic.id }, body })
        : this.api.post('/topics', { body }),
    );
  }
}
