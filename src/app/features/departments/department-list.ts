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
import { firstValueFrom } from 'rxjs';
import { AccessDenied } from '../../core/access';
import { ApiClient, ApiError, type Department } from '../../core/api';
import { ToastService } from '../../core/toast';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { saveFailedMessage } from '../../shared/forms/form-errors';
import { loadAllPages, MAX_PAGE_SIZE } from '../../shared/lists/load-all-pages';
import { DepartmentForm } from './department-form';

const STATUS_LABELS: Record<Department['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
};

/** The form drawer: a new department, or the one being edited. */
interface Editing {
  department: Department | null;
}

/**
 * The Departments page at `/admin/departments`: every department in a list, with search, a status
 * filter and sorting, and actions to create, edit, deactivate and reactivate departments.
 *
 * It is the reference for administrator list pages; see "Admin list and form pattern" in the
 * developer guide.
 */
@Component({
  selector: 'app-department-list',
  imports: [
    AccessDenied,
    ConfirmDialog,
    DepartmentForm,
    SdButton,
    SdCallout,
    SdEmptyState,
    SdList,
    SdSkeleton,
    SdStatusBar,
  ],
  templateUrl: './department-list.html',
  styleUrl: './department-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepartmentList {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  protected readonly icons = { create: LucidePlus };

  /** Every department. `sd-list` searches, filters and sorts them in the browser. */
  protected readonly departments = rxResource({
    stream: () =>
      loadAllPages((page) =>
        this.api.get('/departments', { query: { page, pageSize: MAX_PAGE_SIZE } }),
      ),
  });

  protected readonly error = computed(() => {
    const error = this.departments.error();
    return error instanceof ApiError ? error : null;
  });
  protected readonly failed = computed(() => this.departments.status() === 'error');
  /** Skeleton only on the first load; a reload after a save keeps the list in view. */
  protected readonly firstLoad = computed(
    () => this.departments.isLoading() && !this.departments.hasValue(),
  );

  protected readonly byId = (department: Department) => department.id;
  protected readonly search = signal('');
  protected readonly filterValues = signal<Record<string, string>>({});
  protected readonly sort = signal<SdListSort | null>({ columnId: 'name', dir: 'asc' });

  protected readonly columns: SdListColumn<Department>[] = [
    { id: 'name', label: 'Name', type: 'title', value: (d) => d.name, sortable: true },
    {
      id: 'description',
      label: 'Description',
      value: (d) => d.description,
      // Search matches names only, like the API's `q`.
      searchable: false,
      maxWidth: 'grow',
    },
    {
      id: 'employeeCount',
      label: 'Employees',
      headerTitle: 'Active employees in the department',
      value: (d) => d.employeeCount,
      sortable: true,
      searchable: false,
    },
    {
      id: 'status',
      label: 'Status',
      type: 'badge',
      value: (d) => STATUS_LABELS[d.status],
      tone: (d) => (d.status === 'active' ? 'success' : 'muted'),
      sortable: true,
      searchable: false,
    },
  ];

  protected readonly filters: SdListFilter<Department>[] = [
    {
      id: 'status',
      label: 'Status',
      value: (d) => d.status,
      options: [
        { value: 'active', label: STATUS_LABELS.active },
        { value: 'inactive', label: STATUS_LABELS.inactive },
      ],
    },
  ];

  protected readonly actions: SdListAction<Department>[] = [
    { id: 'edit', label: (d) => `Edit ${d.name}`, icon: LucidePencil },
    {
      id: 'deactivate',
      label: (d) => `Deactivate ${d.name}`,
      icon: LucidePower,
      danger: true,
      hidden: (d) => d.status !== 'active',
    },
    {
      id: 'reactivate',
      label: (d) => `Reactivate ${d.name}`,
      icon: LucideRotateCcw,
      hidden: (d) => d.status !== 'inactive',
    },
  ];

  protected readonly listLabels = {
    search: 'Search by name',
    noMatches: 'No departments match',
    noMatchesDescription: 'Try another name or clear the filters.',
    count: (shown: number, total: number) =>
      shown === total ? `${total} departments` : `${shown} of ${total} departments`,
  };

  /** The form drawer, while it is open. */
  protected readonly editing = signal<Editing | null>(null);

  /** The department whose status is being changed, while the confirmation is open. */
  protected readonly statusTarget = signal<Department | null>(null);
  protected readonly statusSaving = signal(false);
  protected readonly statusError = signal<string | null>(null);
  protected readonly deactivating = computed(() => this.statusTarget()?.status === 'active');

  protected create(): void {
    this.editing.set({ department: null });
  }

  protected edit(department: Department): void {
    this.editing.set({ department });
  }

  protected onAction({ action, row }: SdListActionEvent<Department>): void {
    if (action === 'edit') this.edit(row);
    else this.askStatusChange(row);
  }

  protected onSaved(department: Department, wasNew: boolean): void {
    this.toasts.success(
      wasNew ? 'Department created' : 'Department saved',
      wasNew ? `${department.name} is now in the list.` : `${department.name} is up to date.`,
    );
    this.departments.reload();
  }

  protected askStatusChange(department: Department): void {
    this.statusError.set(null);
    this.statusTarget.set(department);
  }

  protected async changeStatus(): Promise<void> {
    const department = this.statusTarget();
    if (!department || this.statusSaving()) return;
    const status = department.status === 'active' ? 'inactive' : 'active';
    this.statusSaving.set(true);
    this.statusError.set(null);
    try {
      await firstValueFrom(
        this.api.patch('/departments/{departmentId}', {
          path: { departmentId: department.id },
          body: { status },
        }),
      );
      this.statusTarget.set(null);
      this.toasts.success(
        status === 'inactive' ? 'Department deactivated' : 'Department reactivated',
        `${department.name} is now ${STATUS_LABELS[status].toLowerCase()}.`,
      );
      this.departments.reload();
    } catch (error) {
      this.statusError.set(saveFailedMessage(error));
    } finally {
      this.statusSaving.set(false);
    }
  }
}
