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
import { disabled, form, FormField, submit, validate } from '@angular/forms/signals';
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
import { ApiClient, demoLinkOf, type Department, type RoleKey, type User } from '../../core/api';
import { ROLE_LABELS } from '../../core/auth';
import { saveFailedMessage, serverFieldErrors, visibleError } from '../../shared/forms/form-errors';
import { textRules } from '../../shared/forms/text-rules';

/** Limits from the API spec (`UserCreate`). */
const NAME_MAX_LENGTH = 100;
const EMAIL_MAX_LENGTH = 254;
/** Something before and after one `@`, a dot in the domain, no spaces. The API checks it too. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The department select's value for "No department"; sent as `null`. */
const NO_DEPARTMENT = '';

/** The fields the form sends, trimmed. An edit sends only the changed ones. */
type UserFields = Partial<Pick<User, 'firstName' | 'lastName' | 'email' | 'role' | 'departmentId'>>;

/** What `saved` emits: the saved user, and whether and where a new invite was sent. */
export interface EmployeeSaved {
  user: User;
  /**
   * Whether the save sent a new invite: for a new user, and for an email change of a user who has
   * not set a password yet.
   */
  invited: boolean;
  /**
   * Demo only: the invite link the mock API sent in `X-Demo-Link` with the new invite, or null.
   * The real backend emails it instead.
   */
  inviteLink: string | null;
}

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
  /** Fires after a successful save, with the saved record and, for a new user, the invite link. */
  readonly saved = output<EmployeeSaved>();
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
        // The label also shows in the closed select, so it says when the department is inactive.
        label: d.status === 'active' ? d.name : `${d.name} (inactive)`,
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
    // Checked on the trimmed text, as the API checks it.
    textRules(p.firstName, { required: 'Enter a first name.', maxLength: NAME_MAX_LENGTH });
    textRules(p.lastName, { required: 'Enter a last name.', maxLength: NAME_MAX_LENGTH });
    textRules(p.email, { required: 'Enter an email address.', maxLength: EMAIL_MAX_LENGTH });
    validate(p.email, ({ value }) => {
      const text = value().trim();
      return text !== '' && !EMAIL_PATTERN.test(text)
        ? { kind: 'email', message: 'Enter a valid email address.' }
        : undefined;
    });
    disabled(p.firstName, () => this.saving());
    disabled(p.lastName, () => this.saving());
    disabled(p.email, () => this.saving());
    disabled(p.departmentId, () => this.saving());
    disabled(p.role, () => (this.isSelf() ? 'You cannot change your own role.' : this.saving()));
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
      const changes = this.changes();
      // An edit that changes nothing sends nothing: the drawer just closes, with no toast.
      if (changes === null) {
        this.open.set(false);
        return undefined;
      }
      this.saving.set(true);
      try {
        this.saved.emit(await this.send(changes));
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

  /**
   * What to send: every field for a new user; for an edit, only the fields that changed, or null
   * when nothing did. Text is trimmed first, as the API trims it. The role is never sent for the
   * signed-in administrator, who cannot change it.
   */
  private changes(): UserFields | null {
    const { firstName, lastName, email, role, departmentId } = this.model();
    const fields: UserFields = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      role,
      departmentId: departmentId === NO_DEPARTMENT ? null : departmentId,
    };
    const user = this.user();
    if (!user) return fields;
    if (this.isSelf()) delete fields.role;
    const changed = Object.fromEntries(
      Object.entries(fields).filter(([key, value]) => user[key as keyof UserFields] !== value),
    ) as UserFields;
    return Object.keys(changed).length > 0 ? changed : null;
  }

  private async send(fields: UserFields): Promise<EmployeeSaved> {
    const user = this.user();
    if (user) {
      const response = await firstValueFrom(
        this.api.patchWithHeaders('/users/{userId}', { path: { userId: user.id }, body: fields }),
      );
      const saved = response.body;
      // A new email of a user without a password gets a new invite: `invitationSentAt` changes.
      const invited =
        saved.passwordSetAt === null && saved.invitationSentAt !== user.invitationSentAt;
      return { user: saved, invited, inviteLink: demoLinkOf(response) };
    }
    const response = await firstValueFrom(
      this.api.postWithHeaders('/users', { body: fields as Required<UserFields> }),
    );
    return { user: response.body, invited: true, inviteLink: demoLinkOf(response) };
  }
}
