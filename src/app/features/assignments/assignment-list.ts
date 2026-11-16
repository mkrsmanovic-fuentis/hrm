import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  LOCALE_ID,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { LucideClipboardCheck } from '@lucide/angular';
import {
  SdButton,
  SdCallout,
  SdEmptyState,
  SdList,
  SdSkeleton,
  SdStatusBar,
  type SdListColumn,
  type SdListSort,
} from '@specora-dev/ui-kit';
import { AccessDenied } from '../../core/access';
import { ApiClient, ApiError, type Assignment } from '../../core/api';
import { ToastService } from '../../core/toast';
import { AssignResult } from '../../shared/assign-training/assign-result';
import { AssignTrainingForm } from '../../shared/assign-training/assign-training-form';
import {
  type AssignTrainingResult,
  assignResultToast,
} from '../../shared/assign-training/assign-training-result';
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_VARIANTS,
} from '../../shared/assignment-status/assignment-status';
import { loadAllPages, MAX_PAGE_SIZE } from '../../shared/lists/load-all-pages';

/** The hidden column that `sd-list`'s search matches: employee name and questionnaire title. */
const SEARCH_COLUMN = 'search';
const TYPOGRAPHIC_APOSTROPHES = /[‘’ʼ]/g;

/**
 * The name and title with every apostrophe written both ways, so typing "o'neill" finds
 * "O’Neill" and the other way round, like the API's `q`.
 */
const searchText = (a: Assignment) => {
  const plain = `${a.employeeName} ${a.questionnaireTitle}`.replace(TYPOGRAPHIC_APOSTROPHES, "'");
  return `${plain} ${plain.replace(/'/g, '’')}`;
};

/**
 * The Assignments page at `/admin/assignments`: every assignment, newest first, with search by
 * employee name or questionnaire title. "Assign training" opens the shared drawer. After saving,
 * a toast says how many assignments were created, and `<app-assign-result>` lists any employees
 * who were skipped.
 *
 * Status filters, deadline changes and the completion date come later (SPE-21).
 */
@Component({
  selector: 'app-assignment-list',
  imports: [
    AccessDenied,
    AssignResult,
    AssignTrainingForm,
    SdButton,
    SdCallout,
    SdEmptyState,
    SdList,
    SdSkeleton,
    SdStatusBar,
  ],
  templateUrl: './assignment-list.html',
  styleUrl: './assignment-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssignmentList {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);
  private readonly locale = inject(LOCALE_ID);

  protected readonly icons = { assign: LucideClipboardCheck };

  /** Every assignment. Each carries the employee's name, department and questionnaire title. */
  protected readonly data = rxResource({
    stream: () =>
      loadAllPages((page) =>
        this.api.get('/assignments', { query: { page, pageSize: MAX_PAGE_SIZE } }),
      ),
  });

  protected readonly assignments = computed(() => this.data.value() ?? []);
  protected readonly error = computed(() => {
    const error = this.data.error();
    return error instanceof ApiError ? error : null;
  });
  protected readonly failed = computed(() => this.data.status() === 'error');
  /** Skeleton only on the first load; a reload after a save keeps the list in view. */
  protected readonly firstLoad = computed(() => this.data.isLoading() && !this.data.hasValue());

  protected readonly byId = (a: Assignment) => a.id;
  protected readonly search = signal('');
  protected readonly sort = signal<SdListSort | null>({ columnId: 'createdAt', dir: 'desc' });

  private readonly date = (value: string) => formatDate(value, 'mediumDate', this.locale);

  protected readonly columns: SdListColumn<Assignment>[] = [
    {
      id: 'employee',
      label: 'Employee',
      type: 'title',
      value: (a) => a.employeeName,
      sortable: true,
      minWidth: 10,
    },
    {
      id: 'department',
      label: 'Department',
      value: (a) => a.departmentName ?? 'No department',
      sortable: true,
      searchable: false,
      minWidth: 8,
      maxWidth: 13,
    },
    {
      id: 'questionnaire',
      label: 'Questionnaire',
      value: (a) => a.questionnaireTitle,
      sortable: true,
      minWidth: 12,
      maxWidth: 'grow',
    },
    {
      id: 'dueAt',
      label: 'Deadline',
      value: (a) => this.date(a.dueAt),
      sortValue: (a) => Date.parse(a.dueAt),
      sortable: true,
      searchable: false,
      minWidth: 7,
      maxWidth: 9,
    },
    {
      id: 'status',
      label: 'Status',
      type: 'badge',
      value: (a) => ASSIGNMENT_STATUS_LABELS[a.status],
      tone: (a) => ASSIGNMENT_STATUS_VARIANTS[a.status],
      sortable: true,
      searchable: false,
      minWidth: 7,
      maxWidth: 9,
    },
    {
      id: 'createdAt',
      label: 'Assigned',
      headerTitle: 'The date the questionnaire was assigned',
      value: (a) => this.date(a.createdAt),
      sortValue: (a) => Date.parse(a.createdAt),
      sortable: true,
      searchable: false,
      minWidth: 7,
      maxWidth: 9,
    },
    {
      // Never shown: lets the search ignore the kind of apostrophe, like the API's `q`.
      id: SEARCH_COLUMN,
      label: 'Search',
      value: searchText,
    },
  ];
  protected readonly hiddenColumns: ReadonlySet<string> = new Set([SEARCH_COLUMN]);

  protected readonly listLabels = {
    search: 'Search by employee or questionnaire',
    noMatches: 'No assignments match',
    noMatchesDescription: 'Try another name or title.',
    count: (shown: number, total: number) =>
      shown === total ? `${total} assignments` : `${shown} of ${total} assignments`,
  };

  /** Whether the "Assign training" drawer is open. */
  protected readonly assigning = signal(false);
  /** The last result, for the list of skipped employees. */
  protected readonly lastResult = signal<AssignTrainingResult | null>(null);

  protected onAssigned(result: AssignTrainingResult): void {
    const toast = assignResultToast(result);
    this.toasts.show(toast.message, toast.options);
    this.lastResult.set(result);
    this.data.reload();
  }
}
