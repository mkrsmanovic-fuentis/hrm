import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { LucidePencil, LucidePlus, LucidePower, LucideRotateCcw } from '@lucide/angular';
import {
  SdButton,
  SdCallout,
  SdEmptyState,
  SdList,
  SdSkeleton,
  SdStatusBar,
  type SdListAction,
  type SdListActionEvent,
  type SdListColumn,
  type SdListFilter,
  type SdListSort,
} from '@specora-dev/ui-kit';
import { firstValueFrom, forkJoin } from 'rxjs';
import { AccessDenied } from '../../core/access';
import { ApiClient, ApiError, type Department, type User } from '../../core/api';
import { AuthService, ROLE_LABELS } from '../../core/auth';
import { ToastService } from '../../core/toast';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { saveFailedMessage } from '../../shared/forms/form-errors';
import { loadAllPages, MAX_PAGE_SIZE } from '../../shared/lists/load-all-pages';
import { EmployeeForm } from './employee-form';

const STATUS_LABELS: Record<User['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
};
/** The department filter's value for users without a department. */
const NO_DEPARTMENT = 'none';

/** The form drawer: a new user, or the one being edited. */
interface Editing {
  user: User | null;
}

const fullName = (user: Pick<User, 'firstName' | 'lastName'>) =>
  `${user.firstName} ${user.lastName}`;

/** The hidden column that `sd-list`'s search matches, besides name and email. */
const SEARCH_COLUMN = 'search';
const TYPOGRAPHIC_APOSTROPHES = /[‘’ʼ]/g;

/**
 * The name and email with every apostrophe written both ways, so typing "o'neill" finds
 * "O’Neill" and the other way round, like the API's `q`.
 */
const searchText = (user: User) => {
  const text = `${fullName(user)} ${user.email}`;
  const plain = text.replace(TYPOGRAPHIC_APOSTROPHES, "'");
  return `${plain} ${plain.replace(/'/g, '’')}`;
};

/**
 * The Employees page at `/admin/employees`: every user, administrators and employees, with search,
 * filters and sorting, and actions to create, edit, deactivate and reactivate them. Built on the
 * admin list and form pattern, like the Departments page.
 *
 * The signed-in administrator cannot deactivate themselves or change their own role, so their own
 * row has no Deactivate action and their role is locked in the form.
 */
@Component({
  selector: 'app-employee-list',
  imports: [
    AccessDenied,
    ConfirmDialog,
    EmployeeForm,
    SdButton,
    SdCallout,
    SdEmptyState,
    SdList,
    SdSkeleton,
    SdStatusBar,
  ],
  templateUrl: './employee-list.html',
  styleUrl: './employee-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeList {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  private readonly auth = inject(AuthService);

  protected readonly icons = { create: LucidePlus };
  /** The signed-in administrator. They cannot deactivate themselves or change their own role. */
  protected readonly currentUserId = computed(() => this.auth.user()?.id ?? null);

  /**
   * Every user, and every department for the department names, the filter and the form.
   * `sd-list` searches, filters and sorts in the browser.
   */
  protected readonly data = rxResource({
    stream: () =>
      forkJoin({
        users: loadAllPages((page) =>
          this.api.get('/users', { query: { page, pageSize: MAX_PAGE_SIZE } }),
        ),
        departments: loadAllPages((page) =>
          this.api.get('/departments', { query: { page, pageSize: MAX_PAGE_SIZE } }),
        ),
      }),
  });

  protected readonly users = computed(() => this.data.value()?.users ?? []);
  protected readonly departments = computed(() => this.data.value()?.departments ?? []);
  private readonly departmentsById = computed(
    () => new Map(this.departments().map((d) => [d.id, d] as const)),
  );

  protected readonly error = computed(() => {
    const error = this.data.error();
    return error instanceof ApiError ? error : null;
  });
  protected readonly failed = computed(() => this.data.status() === 'error');
  /** Skeleton only on the first load; a reload after a save keeps the list in view. */
  protected readonly firstLoad = computed(() => this.data.isLoading() && !this.data.hasValue());

  protected readonly byId = (user: User) => user.id;
  protected readonly search = signal('');
  protected readonly filterValues = signal<Record<string, string>>({});
  protected readonly sort = signal<SdListSort | null>({ columnId: 'name', dir: 'asc' });

  private readonly isMe = (user: User) => user.id === this.currentUserId();
  private readonly departmentOf = (user: User): Department | null =>
    user.departmentId ? (this.departmentsById().get(user.departmentId) ?? null) : null;

  protected readonly columns: SdListColumn<User>[] = [
    {
      id: 'name',
      label: 'Name',
      type: 'title',
      value: (u) => fullName(u),
      subValue: (u) => (this.isMe(u) ? 'You' : null),
      sortable: true,
      // Widths in rem, so all seven columns and the actions fit next to the side navigation.
      minWidth: 11,
    },
    {
      id: 'email',
      label: 'Email',
      value: (u) => u.email,
      sortable: true,
      minWidth: 12,
      maxWidth: 'grow',
    },
    {
      id: 'department',
      label: 'Department',
      type: 'stacked',
      value: (u) => this.departmentOf(u)?.name ?? 'No department',
      subValue: (u) => (this.departmentOf(u)?.status === 'inactive' ? 'Inactive department' : null),
      sortable: true,
      // Search matches names and emails only, like the API's `q`.
      searchable: false,
      minWidth: 9,
      maxWidth: 13,
    },
    {
      id: 'role',
      label: 'Role',
      value: (u) => ROLE_LABELS[u.role],
      sortable: true,
      searchable: false,
      minWidth: 7,
      maxWidth: 9,
    },
    {
      id: 'status',
      label: 'Status',
      type: 'badge',
      value: (u) => STATUS_LABELS[u.status],
      tone: (u) => (u.status === 'active' ? 'success' : 'muted'),
      sortable: true,
      searchable: false,
      minWidth: 6,
      maxWidth: 7,
    },
    {
      id: 'assignedTrainingCount',
      label: 'Assigned',
      headerTitle: 'Training assigned, in any status',
      value: (u) => u.assignedTrainingCount,
      sortable: true,
      searchable: false,
      minWidth: 6,
      maxWidth: 7,
    },
    {
      id: 'completedTrainingCount',
      label: 'Completed',
      headerTitle: 'Training passed',
      value: (u) => u.completedTrainingCount,
      sortable: true,
      searchable: false,
      minWidth: 6.5,
      maxWidth: 7,
    },
    {
      // Never shown: `sd-list` searches every column, hidden ones too, and has no custom matcher.
      // This one lets the search ignore the kind of apostrophe.
      id: SEARCH_COLUMN,
      label: 'Search',
      value: searchText,
    },
  ];
  protected readonly hiddenColumns: ReadonlySet<string> = new Set([SEARCH_COLUMN]);

  protected readonly filters = computed<SdListFilter<User>[]>(() => [
    {
      id: 'status',
      label: 'Status',
      value: (u) => u.status,
      options: [
        { value: 'active', label: STATUS_LABELS.active },
        { value: 'inactive', label: STATUS_LABELS.inactive },
      ],
    },
    {
      id: 'role',
      label: 'Role',
      value: (u) => u.role,
      options: [
        { value: 'administrator', label: ROLE_LABELS.administrator },
        { value: 'employee', label: ROLE_LABELS.employee },
      ],
    },
    {
      id: 'department',
      label: 'Department',
      value: (u) => u.departmentId ?? NO_DEPARTMENT,
      options: [
        { value: NO_DEPARTMENT, label: 'No department' },
        ...[...this.departments()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => ({
            value: d.id,
            label: d.status === 'active' ? d.name : `${d.name} (inactive)`,
          })),
      ],
    },
  ]);

  protected readonly actions: SdListAction<User>[] = [
    { id: 'edit', label: (u) => `Edit ${fullName(u)}`, icon: LucidePencil },
    {
      id: 'deactivate',
      label: (u) => `Deactivate ${fullName(u)}`,
      icon: LucidePower,
      danger: true,
      // Administrators cannot deactivate themselves.
      hidden: (u) => u.status !== 'active' || this.isMe(u),
    },
    {
      id: 'reactivate',
      label: (u) => `Reactivate ${fullName(u)}`,
      icon: LucideRotateCcw,
      hidden: (u) => u.status !== 'inactive',
    },
  ];

  protected readonly listLabels = {
    search: 'Search by name or email',
    noMatches: 'No employees match',
    noMatchesDescription: 'Try another name or email, or clear the filters.',
    count: (shown: number, total: number) =>
      shown === total ? `${total} people` : `${shown} of ${total} people`,
  };

  /** The form drawer, while it is open. */
  protected readonly editing = signal<Editing | null>(null);

  /** The user whose status is being changed, while the confirmation is open. */
  protected readonly statusTarget = signal<User | null>(null);
  protected readonly statusSaving = signal(false);
  protected readonly statusError = signal<string | null>(null);
  protected readonly deactivating = computed(() => this.statusTarget()?.status === 'active');
  protected readonly fullName = fullName;

  protected create(): void {
    this.editing.set({ user: null });
  }

  protected edit(user: User): void {
    this.editing.set({ user });
  }

  protected onAction({ action, row }: SdListActionEvent<User>): void {
    if (action === 'edit') this.edit(row);
    else this.askStatusChange(row);
  }

  protected onSaved(user: User, wasNew: boolean): void {
    if (wasNew) {
      this.toasts.success(
        'Employee created',
        `An invite to set a password was sent to ${user.email}.`,
      );
    } else {
      this.toasts.success('Employee saved', `${fullName(user)} is up to date.`);
    }
    this.data.reload();
  }

  protected askStatusChange(user: User): void {
    this.statusError.set(null);
    this.statusTarget.set(user);
  }

  protected async changeStatus(): Promise<void> {
    const user = this.statusTarget();
    if (!user || this.statusSaving()) return;
    const status = user.status === 'active' ? 'inactive' : 'active';
    this.statusSaving.set(true);
    this.statusError.set(null);
    try {
      await firstValueFrom(
        this.api.patch('/users/{userId}', { path: { userId: user.id }, body: { status } }),
      );
      this.statusTarget.set(null);
      this.toasts.success(
        status === 'inactive' ? 'Employee deactivated' : 'Employee reactivated',
        status === 'inactive'
          ? `${fullName(user)} is signed out and can no longer sign in.`
          : `${fullName(user)} is active again.`,
      );
      this.data.reload();
    } catch (error) {
      this.statusError.set(saveFailedMessage(error));
    } finally {
      this.statusSaving.set(false);
    }
  }
}
