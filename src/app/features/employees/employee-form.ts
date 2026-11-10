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
  email,
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
  SdInput,
  SdSegmented,
  SdSelect,
  type SdSegmentedOption,
  type SdSelectOption,
} from '@specora-dev/ui-kit';
import { firstValueFrom } from 'rxjs';
import { ApiClient, type Department, type RoleKey, type User } from '../../core/api';
import { ROLE_LABELS } from '../../core/auth';
import { saveFailedMessage, serverFieldErrors, visibleError } from '../../shared/forms/form-errors';

/** Limits from the API spec (`UserCreate`). */
const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 254;
/** The department select's value for "No department"; sent as `null`. */
const NO_DEPARTMENT = '';

interface EmployeeModel {
  firstName: string;
  lastName: string;
  email: string;
  role: RoleKey;
  departmentId: string;
}

/**
 * Creates a user, or edits one, in a drawer. Copies the department form: the parent adds it with
 * `@if` and removes it on `closed`; on success it emits `saved` and closes itself.
 *
 * - Only active departments can be chosen. A user already in an inactive department keeps it: it
 *   stays in the options, marked inactive.
 * - Administrators cannot change their own role, so the role is disabled on their own record.
 */
@Component({
  selector: 'app-employee-form',
  imports: [FormField, SdButton, SdCallout, SdDrawer, SdField, SdInput, SdSegmented, SdSelect],
  templateUrl: './employee-form.html',
  styleUrl: './employee-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeForm implements OnInit {
  private readonly api = inject(ApiClient);

  /** The user to edit, or null to create one. */
  readonly user = input<User | null>(null);
  /** Every department, active and inactive. */
  readonly departments = input<readonly Department[]>([]);
  /** The signed-in administrator, who cannot change their own role. */
  readonly currentUserId = input<string | null>(null);
  /** Fires after a successful save, with the saved record. */
  readonly saved = output<User>();
  /** Fires once the drawer has closed, after a save or a cancel. */
  readonly closed = output();

  protected readonly open = signal(true);
  protected readonly saving = signal(false);
  /** Why the last save failed, when the API named no field. */
  protected readonly formError = signal<string | null>(null);

  protected readonly isNew = computed(() => this.user() === null);
  protected readonly isSelf = computed(() => {
    const user = this.user();
    return user !== null && user.id === this.currentUserId();
  });
  protected readonly heading = computed(() => (this.isNew() ? 'New employee' : 'Edit employee'));

  protected readonly roleOptions: SdSegmentedOption<RoleKey>[] = [
    { value: 'employee', label: ROLE_LABELS.employee },
    { value: 'administrator', label: ROLE_LABELS.administrator },
  ];

  /** "No department", the active departments, and the user's own department if it is inactive. */
  protected readonly departmentOptions = computed<SdSelectOption<string>[]>(() => {
    const currentId = this.user()?.departmentId ?? null;
    const choosable = this.departments()
      .filter((d) => d.status === 'active' || d.id === currentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    return [
      { value: NO_DEPARTMENT, label: 'No department' },
      ...choosable.map((d) => ({
        value: d.id,
        label: d.name,
        description:
          d.status === 'active' ? undefined : 'Inactive. Kept because they are already in it.',
      })),
    ];
  });

  protected readonly model = signal<EmployeeModel>({
    firstName: '',
    lastName: '',
    email: '',
    role: 'employee',
    departmentId: NO_DEPARTMENT,
  });
  protected readonly f = form(this.model, (p) => {
    for (const [name, label] of [
      [p.firstName, 'a first name'],
      [p.lastName, 'a last name'],
    ] as const) {
      required(name, { message: `Enter ${label}.` });
      validate(name, ({ value }) =>
        value() !== '' && value().trim() === ''
          ? { kind: 'blank', message: `Enter ${label}.` }
          : undefined,
      );
      maxLength(name, NAME_MAX_LENGTH, { message: `Use ${NAME_MAX_LENGTH} characters or fewer.` });
    }
    required(p.email, { message: 'Enter an email address.' });
    email(p.email, { message: 'Enter a valid email address.' });
    maxLength(p.email, EMAIL_MAX_LENGTH, {
      message: `Use ${EMAIL_MAX_LENGTH} characters or fewer.`,
    });
    disabled(p.firstName, () => this.saving());
    disabled(p.lastName, () => this.saving());
    disabled(p.email, () => this.saving());
    disabled(p.departmentId, () => this.saving());
    disabled(p.role, () =>
      this.isSelf() ? 'You cannot change your own role.' : this.saving(),
    );
  });

  protected readonly visibleError = visibleError;

  ngOnInit(): void {
    const user = this.user();
    if (user) {
      this.model.set({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId ?? NO_DEPARTMENT,
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
        const user = await this.send();
        this.saved.emit(user);
        this.open.set(false);
        return undefined;
      } catch (error) {
        const fieldErrors = serverFieldErrors(error, {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          role: form.role,
          departmentId: form.departmentId,
        });
        if (fieldErrors) return fieldErrors;
        this.formError.set(saveFailedMessage(error));
        return undefined;
      } finally {
        this.saving.set(false);
      }
    });
  }

  private send(): Promise<User> {
    const { firstName, lastName, email, role, departmentId } = this.model();
    const fields = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      departmentId: departmentId === NO_DEPARTMENT ? null : departmentId,
    };
    const user = this.user();
    if (!user) return firstValueFrom(this.api.post('/users', { body: { ...fields, role } }));
    // The role is not sent for the signed-in administrator, who cannot change it.
    const body = this.isSelf() ? fields : { ...fields, role };
    return firstValueFrom(
      this.api.patch('/users/{userId}', { path: { userId: user.id }, body }),
    );
  }
}
