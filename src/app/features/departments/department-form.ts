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
import { SdButton, SdCallout, SdDrawer, SdField, SdInput } from '@specora-dev/ui-kit';
import { firstValueFrom } from 'rxjs';
import { ApiClient, type Department } from '../../core/api';
import { saveFailedMessage, serverFieldErrors, visibleError } from '../../shared/forms/form-errors';

/** Limits from the API spec (`DepartmentCreate`). */
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 500;

/**
 * Creates a department, or edits one, in a drawer. The parent adds it with `@if` when the drawer
 * should open, and removes it on `closed`. On success it emits `saved` with the saved record and
 * closes itself.
 *
 * Rules the API also checks are checked here first, so most mistakes show without a request.
 * Errors the API finds (`422`, or `409` for a duplicate name) show on their fields.
 */
@Component({
  selector: 'app-department-form',
  imports: [FormField, SdButton, SdCallout, SdDrawer, SdField, SdInput],
  templateUrl: './department-form.html',
  styleUrl: './department-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepartmentForm implements OnInit {
  private readonly api = inject(ApiClient);

  /** The department to edit, or null to create one. */
  readonly department = input<Department | null>(null);
  /** Fires after a successful save, with the saved record. */
  readonly saved = output<Department>();
  /** Fires once the drawer has closed, after a save or a cancel. */
  readonly closed = output();

  protected readonly open = signal(true);
  protected readonly saving = signal(false);
  /** Why the last save failed, when the API named no field. */
  protected readonly formError = signal<string | null>(null);

  protected readonly isNew = computed(() => this.department() === null);
  protected readonly heading = computed(() =>
    this.isNew() ? 'New department' : 'Edit department',
  );

  protected readonly model = signal({ name: '', description: '' });
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
    maxLength(p.description, DESCRIPTION_MAX_LENGTH, {
      message: `Use ${DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    });
    disabled(p.name, () => this.saving());
    disabled(p.description, () => this.saving());
  });

  protected readonly visibleError = visibleError;

  ngOnInit(): void {
    const department = this.department();
    if (department) {
      this.model.set({ name: department.name, description: department.description ?? '' });
    }
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    this.formError.set(null);
    await submit(this.f, async (form) => {
      this.saving.set(true);
      try {
        const department = await this.send();
        this.saved.emit(department);
        this.open.set(false);
        return undefined;
      } catch (error) {
        const fieldErrors = serverFieldErrors(error, {
          name: form.name,
          description: form.description,
        });
        if (fieldErrors) return fieldErrors;
        this.formError.set(saveFailedMessage(error));
        return undefined;
      } finally {
        this.saving.set(false);
      }
    });
  }

  private send(): Promise<Department> {
    const { name, description } = this.model();
    const body = { name: name.trim(), description: description.trim() || null };
    const department = this.department();
    return firstValueFrom(
      department
        ? this.api.patch('/departments/{departmentId}', {
            path: { departmentId: department.id },
            body,
          })
        : this.api.post('/departments', { body }),
    );
  }
}
