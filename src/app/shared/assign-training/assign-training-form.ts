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
import { rxResource } from '@angular/core/rxjs-interop';
import {
  disabled,
  form,
  FormField,
  minDate,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import {
  SdButton,
  SdCallout,
  SdDatePicker,
  SdDrawer,
  SdField,
  SdMultiselect,
  SdSegmented,
  SdSelect,
  SdSkeleton,
  type SdSegmentedOption,
  type SdSelectOption,
} from '@specora-dev/ui-kit';
import { firstValueFrom, forkJoin } from 'rxjs';
import { ApiClient, ApiError, type AssignmentCreate, type User } from '../../core/api';
import { saveFailedMessage, serverFieldErrors, visibleError } from '../forms/form-errors';
import { loadAllPages, MAX_PAGE_SIZE } from '../lists/load-all-pages';
import { type AssignTrainingResult, fullName } from './assign-training-result';

/** Who the questionnaire is assigned to: selected employees, or a whole department. */
export type AssignTarget = 'employees' | 'department';

interface AssignModel {
  questionnaireId: string | null;
  target: AssignTarget;
  userIds: string[];
  departmentId: string | null;
  deadline: Date | null;
}

/** Midnight at the start of today, in the browser's time zone. */
function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * The deadline the API gets for a picked day: the end of that day (23:59:59) in the browser's time
 * zone, as a UTC timestamp. See "Assigning training" in the business rules.
 */
export function endOfDay(day: Date): string {
  const end = new Date(day);
  end.setHours(23, 59, 59, 0);
  return end.toISOString();
}

/**
 * The "Assign training" drawer: assigns a questionnaire to selected employees or to a whole
 * department, with a deadline. Used by the Assignments page and by a questionnaire's detail page,
 * which passes `questionnaireId` to start with it chosen.
 *
 * It loads what it offers itself:
 * - Questionnaire: only active questionnaires in active topics.
 * - Employees: only active users with the role `employee`. Administrators cannot be assigned.
 * - Department: only active departments.
 *
 * The parent adds it with `@if` and removes it on `closed`. On success it emits `saved` with what
 * the API created and skipped, and closes itself; the parent shows the toast and the skipped list.
 */
@Component({
  selector: 'app-assign-training-form',
  imports: [
    FormField,
    SdButton,
    SdCallout,
    SdDatePicker,
    SdDrawer,
    SdField,
    SdMultiselect,
    SdSegmented,
    SdSelect,
    SdSkeleton,
  ],
  templateUrl: './assign-training-form.html',
  styleUrl: './assign-training-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssignTrainingForm implements OnInit {
  private readonly api = inject(ApiClient);

  /** The questionnaire to start with, or null to let the administrator choose. */
  readonly questionnaireId = input<string | null>(null);
  /** Fires after a successful save, with the created and skipped employees. */
  readonly saved = output<AssignTrainingResult>();
  /** Fires once the drawer has closed, after a save or a cancel. */
  readonly closed = output();

  protected readonly open = signal(true);
  protected readonly saving = signal(false);
  /** Why the last save failed, when the API named no field of the form. */
  protected readonly formError = signal<string | null>(null);

  /** What the drawer offers, loaded once when it opens. */
  protected readonly options = rxResource({
    stream: () =>
      forkJoin({
        questionnaires: loadAllPages((page) =>
          this.api.get('/questionnaires', {
            query: { page, pageSize: MAX_PAGE_SIZE, status: 'active' },
          }),
        ),
        topics: loadAllPages((page) =>
          this.api.get('/topics', { query: { page, pageSize: MAX_PAGE_SIZE, status: 'active' } }),
        ),
        employees: loadAllPages((page) =>
          this.api.get('/users', {
            query: { page, pageSize: MAX_PAGE_SIZE, status: 'active', role: 'employee' },
          }),
        ),
        departments: loadAllPages((page) =>
          this.api.get('/departments', { query: { page, pageSize: MAX_PAGE_SIZE } }),
        ),
      }),
  });
  private readonly loaded = computed(() => (this.options.hasValue() ? this.options.value() : null));
  protected readonly loading = computed(() => this.options.isLoading());
  protected readonly loadFailed = computed(() => this.options.status() === 'error');

  private readonly employees = computed(() => this.loaded()?.employees ?? []);
  private readonly departmentNames = computed(
    () => new Map((this.loaded()?.departments ?? []).map((d) => [d.id, d.name] as const)),
  );

  /** Active questionnaires in active topics, by title, with the topic under each. */
  protected readonly questionnaireOptions = computed<SdSelectOption<string>[]>(() => {
    const data = this.loaded();
    if (!data) return [];
    const topicNames = new Map(data.topics.map((t) => [t.id, t.name] as const));
    return data.questionnaires
      .filter((q) => topicNames.has(q.topicId))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((q) => ({ value: q.id, label: q.title, description: topicNames.get(q.topicId) }));
  });

  /** Active employees, by name, with their department under each. */
  protected readonly employeeOptions = computed<SdSelectOption<string>[]>(() =>
    [...this.employees()]
      .sort((a, b) => fullName(a).localeCompare(fullName(b)))
      .map((u) => ({
        value: u.id,
        label: fullName(u),
        description: this.departmentOf(u) ?? 'No department',
      })),
  );

  /** Active departments, by name. */
  protected readonly departmentOptions = computed<SdSelectOption<string>[]>(() =>
    (this.loaded()?.departments ?? [])
      .filter((d) => d.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ value: d.id, label: d.name })),
  );

  protected readonly targetOptions: SdSegmentedOption<AssignTarget>[] = [
    { value: 'employees', label: 'Selected employees' },
    { value: 'department', label: 'A department' },
  ];

  /** The earliest deadline: today. The deadline is the end of the chosen day. */
  protected readonly today = startOfToday();

  protected readonly model = signal<AssignModel>({
    questionnaireId: null,
    target: 'employees',
    userIds: [],
    departmentId: null,
    deadline: null,
  });
  protected readonly byEmployees = computed(() => this.model().target === 'employees');

  protected readonly f = form(this.model, (p) => {
    required(p.questionnaireId, { message: 'Choose a questionnaire.' });
    validate(p.userIds, ({ value }) =>
      this.byEmployees() && value().length === 0
        ? { kind: 'required', message: 'Choose at least one employee.' }
        : undefined,
    );
    validate(p.departmentId, ({ value }) =>
      !this.byEmployees() && !value()
        ? { kind: 'required', message: 'Choose a department.' }
        : undefined,
    );
    required(p.deadline, { message: 'Choose a deadline.' });
    // Also passes the earliest day to the date picker through `[formField]`.
    minDate(p.deadline, this.today, { message: 'Choose today or a later day.' });
    const busy = () => this.saving() || this.loading();
    disabled(p.questionnaireId, busy);
    disabled(p.target, busy);
    disabled(p.userIds, busy);
    disabled(p.departmentId, busy);
    disabled(p.deadline, busy);
  });

  protected readonly visibleError = visibleError;

  ngOnInit(): void {
    const questionnaireId = this.questionnaireId();
    if (questionnaireId) this.model.update((m) => ({ ...m, questionnaireId }));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving() || this.loading()) return;
    this.formError.set(null);
    await submit(this.f, async (form) => {
      const model = this.model();
      const body: AssignmentCreate = {
        questionnaireId: model.questionnaireId ?? '',
        dueAt: endOfDay(model.deadline ?? this.today),
        ...(model.target === 'employees'
          ? { userIds: model.userIds }
          : { departmentId: model.departmentId ?? '' }),
      };
      this.saving.set(true);
      try {
        const result = await firstValueFrom(this.api.post('/assignments', { body }));
        this.saved.emit({
          questionnaireTitle:
            this.questionnaireOptions().find((o) => o.value === body.questionnaireId)?.label ?? '',
          createdCount: result.assignments.length,
          skipped: result.skipped.map((s) => ({
            userId: s.userId,
            reason: s.reason,
            name: this.nameOf(s.userId),
          })),
        });
        this.open.set(false);
        return undefined;
      } catch (error) {
        const fieldErrors = serverFieldErrors(error, {
          questionnaireId: form.questionnaireId,
          userIds: form.userIds,
          departmentId: form.departmentId,
          dueAt: form.deadline,
        });
        if (fieldErrors) return fieldErrors;
        // A problem with one of the chosen employees names `userIds[<index>]`.
        const employeeError =
          error instanceof ApiError && error.isValidation
            ? error.fieldErrors.find((e) => e.field.startsWith('userIds['))
            : undefined;
        if (employeeError) {
          return [{ kind: 'server', message: employeeError.message, fieldTree: form.userIds }];
        }
        this.formError.set(saveFailedMessage(error));
        return undefined;
      } finally {
        this.saving.set(false);
      }
    });
  }

  private departmentOf(user: User): string | null {
    return user.departmentId ? (this.departmentNames().get(user.departmentId) ?? null) : null;
  }

  private nameOf(userId: string): string {
    const user = this.employees().find((u) => u.id === userId);
    return user ? fullName(user) : 'An employee';
  }
}
