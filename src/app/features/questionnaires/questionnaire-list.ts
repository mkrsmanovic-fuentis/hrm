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
import { Router } from '@angular/router';
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
import { forkJoin } from 'rxjs';
import { AccessDenied } from '../../core/access';
import { ApiClient, ApiError, type Questionnaire, type Topic } from '../../core/api';
import { ToastService } from '../../core/toast';
import { loadAllPages, MAX_PAGE_SIZE } from '../../shared/lists/load-all-pages';
import { QuestionnaireForm } from './questionnaire-form';
import { QuestionnaireStatusDialog } from './questionnaire-status-dialog';
import { canActivate, passingScoreText, STATUS_LABELS } from './questionnaire-text';

/**
 * The Questionnaires page at `/admin/questionnaires`: every questionnaire in a list, with
 * search, filters for topic and status, and sorting. New questionnaires are created in a drawer,
 * then open on their detail page. Rows open the detail page, and row actions deactivate and
 * activate.
 *
 * Follows the Departments page; see "Admin list and form pattern" in the developer guide.
 */
@Component({
  selector: 'app-questionnaire-list',
  imports: [
    AccessDenied,
    QuestionnaireForm,
    QuestionnaireStatusDialog,
    SdButton,
    SdCallout,
    SdEmptyState,
    SdList,
    SdSkeleton,
    SdStatusBar,
  ],
  templateUrl: './questionnaire-list.html',
  styleUrl: './questionnaire-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionnaireList {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly locale = inject(LOCALE_ID);

  protected readonly icons = { create: LucidePlus };

  /**
   * Every questionnaire and every topic, for the topic names and the topic filter. `sd-list`
   * searches, filters and sorts them in the browser.
   */
  protected readonly data = rxResource({
    stream: () =>
      forkJoin({
        questionnaires: loadAllPages((page) =>
          this.api.get('/questionnaires', { query: { page, pageSize: MAX_PAGE_SIZE } }),
        ),
        topics: loadAllPages((page) =>
          this.api.get('/topics', { query: { page, pageSize: MAX_PAGE_SIZE } }),
        ),
      }),
  });

  /** The loaded data; `value()` throws while the resource is in an error state. */
  private readonly loaded = computed(() => (this.data.hasValue() ? this.data.value() : null));
  protected readonly questionnaires = computed(() => this.loaded()?.questionnaires ?? []);
  protected readonly topics = computed(() => this.loaded()?.topics ?? []);
  private readonly topicNames = computed(
    () => new Map(this.topics().map((topic) => [topic.id, topic.name])),
  );

  protected readonly error = computed(() => {
    const error = this.data.error();
    return error instanceof ApiError ? error : null;
  });
  protected readonly failed = computed(() => this.data.status() === 'error');
  /** Skeleton only on the first load; a reload after a save keeps the list in view. */
  protected readonly firstLoad = computed(() => this.data.isLoading() && !this.data.hasValue());

  protected readonly byId = (questionnaire: Questionnaire) => questionnaire.id;
  protected readonly search = signal('');
  protected readonly filterValues = signal<Record<string, string>>({});
  protected readonly sort = signal<SdListSort | null>({ columnId: 'title', dir: 'asc' });

  protected readonly columns: SdListColumn<Questionnaire>[] = [
    {
      id: 'title',
      label: 'Title',
      type: 'title',
      value: (q) => q.title,
      sortable: true,
    },
    {
      id: 'topic',
      label: 'Topic',
      value: (q) => this.topicName(q.topicId),
      sortable: true,
      // Search matches titles only, like the API's `q`.
      searchable: false,
    },
    {
      id: 'questionCount',
      label: 'Questions',
      headerTitle: 'Questions in the current version',
      value: (q) => q.questionCount,
      sortable: true,
      searchable: false,
    },
    {
      id: 'passingScore',
      label: 'Passing score',
      value: (q) => passingScoreText(q.passingScore),
      sortValue: (q) => q.passingScore,
      sortable: true,
      searchable: false,
    },
    {
      id: 'status',
      label: 'Status',
      type: 'badge',
      value: (q) => STATUS_LABELS[q.status],
      tone: (q) => (q.status === 'active' ? 'success' : 'muted'),
      sortable: true,
      searchable: false,
    },
    {
      id: 'createdAt',
      label: 'Created',
      type: 'meta',
      value: (q) => formatDate(q.createdAt, 'mediumDate', this.locale),
      sortValue: (q) => Date.parse(q.createdAt),
      sortable: true,
      searchable: false,
    },
  ];

  protected readonly filters = computed<SdListFilter<Questionnaire>[]>(() => [
    {
      id: 'topic',
      label: 'Topic',
      value: (q) => q.topicId,
      options: [...this.topics()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((topic: Topic) => ({ value: topic.id, label: topic.name })),
    },
    {
      id: 'status',
      label: 'Status',
      value: (q) => q.status,
      options: [
        { value: 'active', label: STATUS_LABELS.active },
        { value: 'inactive', label: STATUS_LABELS.inactive },
      ],
    },
  ]);

  protected readonly actions: SdListAction<Questionnaire>[] = [
    { id: 'open', label: (q) => `Open ${q.title}`, icon: LucidePencil },
    {
      id: 'deactivate',
      label: (q) => `Deactivate ${q.title}`,
      icon: LucidePower,
      danger: true,
      hidden: (q) => q.status !== 'active',
    },
    {
      id: 'activate',
      label: (q) =>
        canActivate(q) ? `Activate ${q.title}` : `Add questions to ${q.title} before activating it`,
      icon: LucideRotateCcw,
      hidden: (q) => q.status !== 'inactive',
      disabled: (q) => !canActivate(q),
    },
  ];

  protected readonly listLabels = {
    search: 'Search by title',
    noMatches: 'No questionnaires match',
    noMatchesDescription: 'Try another title or clear the filters.',
    count: (shown: number, total: number) =>
      shown === total ? `${total} questionnaires` : `${shown} of ${total} questionnaires`,
  };

  /** The create drawer, while it is open. */
  protected readonly creating = signal(false);
  /** The questionnaire whose status is being changed, while the confirmation is open. */
  protected readonly statusTarget = signal<Questionnaire | null>(null);

  protected topicName(topicId: string): string {
    return this.topicNames().get(topicId) ?? '';
  }

  protected open(questionnaire: Questionnaire): void {
    void this.router.navigate(['/admin/questionnaires', questionnaire.id]);
  }

  protected onAction({ action, row }: SdListActionEvent<Questionnaire>): void {
    if (action === 'open') this.open(row);
    else this.statusTarget.set(row);
  }

  protected onCreated(questionnaire: Questionnaire): void {
    this.toasts.success(
      'Questionnaire created',
      `${questionnaire.title} is saved as an inactive draft.`,
    );
    this.open(questionnaire);
  }
}
