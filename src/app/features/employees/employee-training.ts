import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  LOCALE_ID,
  signal,
} from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideSearchX, LucideUser } from '@lucide/angular';
import {
  SdButton,
  SdCallout,
  SdEmptyState,
  SdList,
  SdSkeleton,
  SdStatusBar,
  type SdBreadcrumbItem,
  type SdListColumn,
  type SdListSort,
  type SdStatusBarStat,
} from '@specora-dev/ui-kit';
import { forkJoin, map, type Observable, of, switchMap } from 'rxjs';
import { AccessDenied } from '../../core/access';
import { ApiClient, ApiError, type Assignment, type Department, type User } from '../../core/api';
import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_VARIANTS,
} from '../../shared/assignment-status/assignment-status';
import { loadAllPages, MAX_PAGE_SIZE } from '../../shared/lists/load-all-pages';

const LIST_URL = '/admin/employees';

/** Shown in a cell that has no value yet: no score, not completed. */
const NONE = '—';

const STATUS_LABELS: Record<User['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
};

/** A score as the business rules show it: rounded down to a whole percent. */
export function scoreText(score: number | null): string {
  return score === null ? NONE : `${Math.floor(score)}%`;
}

/**
 * One employee's training history at `/admin/employees/{userId}/training`: every assignment they
 * have ever had, newest first, in any status. Opened from the "Training history" row action on
 * the Employees page.
 *
 * It works for inactive employees too, and lists questionnaires and topics deactivated since
 * assigning, marked as inactive: assignments, attempts and results are never deleted.
 *
 * The individual attempts with their answers come later (SPE-29).
 */
@Component({
  selector: 'app-employee-training',
  imports: [
    AccessDenied,
    RouterLink,
    SdButton,
    SdCallout,
    SdEmptyState,
    SdList,
    SdSkeleton,
    SdStatusBar,
  ],
  templateUrl: './employee-training.html',
  styleUrl: './employee-training.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeTraining {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly locale = inject(LOCALE_ID);

  protected readonly icons = { back: LucideArrowLeft, notFound: LucideSearchX, user: LucideUser };

  private readonly userId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('userId') ?? '')),
    { initialValue: '' },
  );

  /** The employee, their department for its name, and every assignment they have had. */
  protected readonly data = rxResource({
    params: () => ({ userId: this.userId() }),
    stream: ({ params }) =>
      forkJoin({
        user: this.api.get('/users/{userId}', { path: params }),
        assignments: loadAllPages((page) =>
          this.api.get('/assignments', {
            query: { userId: params.userId, page, pageSize: MAX_PAGE_SIZE },
          }),
        ),
      }).pipe(
        switchMap(({ user, assignments }) =>
          this.departmentOf(user).pipe(map((department) => ({ user, department, assignments }))),
        ),
      ),
  });

  /** The loaded data; `value()` throws while the resource is in an error state. */
  private readonly loaded = computed(() => (this.data.hasValue() ? this.data.value() : null));
  protected readonly user = computed(() => this.loaded()?.user ?? null);
  protected readonly assignments = computed(() => this.loaded()?.assignments ?? []);

  protected readonly error = computed(() => {
    const error = this.data.error();
    return error instanceof ApiError ? error : null;
  });
  protected readonly failed = computed(() => this.data.status() === 'error');
  protected readonly firstLoad = computed(() => this.data.isLoading() && !this.data.hasValue());

  protected readonly name = computed(() => {
    const user = this.user();
    return user ? `${user.firstName} ${user.lastName}` : null;
  });

  protected readonly breadcrumb = computed<SdBreadcrumbItem[]>(() => [
    { label: 'Employees', route: LIST_URL },
    { label: 'Training history' },
  ]);

  protected readonly stats = computed<SdStatusBarStat[]>(() => {
    const loaded = this.loaded();
    if (!loaded) return [];
    const { user, department } = loaded;
    return [
      {
        label: 'Department',
        value: department
          ? department.status === 'active'
            ? department.name
            : `${department.name} (inactive)`
          : 'No department',
      },
      {
        label: 'Status',
        badge: {
          label: STATUS_LABELS[user.status],
          tone: user.status === 'active' ? 'success' : 'muted',
        },
      },
    ];
  });

  protected readonly byId = (a: Assignment) => a.id;
  protected readonly sort = signal<SdListSort | null>({ columnId: 'createdAt', dir: 'desc' });

  private readonly date = (value: string) => formatDate(value, 'mediumDate', this.locale);

  protected readonly columns: SdListColumn<Assignment>[] = [
    {
      id: 'questionnaire',
      label: 'Questionnaire',
      type: 'title',
      value: (a) => a.questionnaireTitle,
      subValue: (a) => (a.questionnaireStatus === 'inactive' ? 'Inactive questionnaire' : null),
      sortable: true,
      minWidth: 11,
    },
    {
      id: 'topic',
      label: 'Topic',
      type: 'stacked',
      value: (a) => a.topicName,
      subValue: (a) => (a.topicStatus === 'inactive' ? 'Inactive topic' : null),
      sortable: true,
      minWidth: 8,
      maxWidth: 12,
    },
    {
      id: 'createdAt',
      label: 'Assigned',
      headerTitle: 'The date the questionnaire was assigned',
      value: (a) => this.date(a.createdAt),
      sortValue: (a) => Date.parse(a.createdAt),
      sortable: true,
      minWidth: 7,
      maxWidth: 9,
    },
    {
      id: 'dueAt',
      label: 'Deadline',
      value: (a) => this.date(a.dueAt),
      sortValue: (a) => Date.parse(a.dueAt),
      sortable: true,
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
      minWidth: 7,
      maxWidth: 9,
    },
    {
      id: 'attemptCount',
      label: 'Attempts',
      headerTitle: 'Attempts started, including one in progress',
      value: (a) => a.attemptCount,
      sortable: true,
      minWidth: 5.5,
      maxWidth: 6.5,
    },
    {
      id: 'latestScore',
      label: 'Latest score',
      headerTitle: 'Score of the latest submitted attempt, rounded down',
      value: (a) => scoreText(a.latestScore),
      sortValue: (a) => a.latestScore ?? -1,
      sortable: true,
      minWidth: 6.5,
      maxWidth: 7.5,
    },
    {
      id: 'completedAt',
      label: 'Completed',
      headerTitle: 'The date the questionnaire was passed',
      value: (a) => (a.completedAt ? this.date(a.completedAt) : NONE),
      sortValue: (a) => (a.completedAt ? Date.parse(a.completedAt) : 0),
      sortable: true,
      minWidth: 7,
      maxWidth: 9,
    },
  ];

  protected readonly listLabels = {
    count: (shown: number, total: number) =>
      shown === total ? `${total} assignments` : `${shown} of ${total} assignments`,
  };

  /** The employee's department, for its name and status. */
  private departmentOf(user: User): Observable<Department | null> {
    return user.departmentId
      ? this.api.get('/departments/{departmentId}', { path: { departmentId: user.departmentId } })
      : of(null);
  }

  protected back(): void {
    void this.router.navigateByUrl(LIST_URL);
  }
}
