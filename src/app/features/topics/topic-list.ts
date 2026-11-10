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
import { ApiClient, ApiError, type Topic } from '../../core/api';
import { ToastService } from '../../core/toast';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { saveFailedMessage } from '../../shared/forms/form-errors';
import { loadAllPages, MAX_PAGE_SIZE } from '../../shared/lists/load-all-pages';
import { TopicForm } from './topic-form';
import { topicListIcon } from './topic-icons';

const STATUS_LABELS: Record<Topic['status'], string> = {
  active: 'Active',
  inactive: 'Inactive',
};

/** The form drawer: a new topic, or the one being edited. */
interface Editing {
  topic: Topic | null;
}

/**
 * The Topics page at `/admin/topics`: every topic in a list, with search, a status filter and
 * sorting, and actions to create, edit, deactivate and reactivate topics.
 *
 * Follows the Departments page; see "Admin list and form pattern" in the developer guide.
 */
@Component({
  selector: 'app-topic-list',
  imports: [
    AccessDenied,
    ConfirmDialog,
    TopicForm,
    SdButton,
    SdCallout,
    SdEmptyState,
    SdList,
    SdSkeleton,
    SdStatusBar,
  ],
  templateUrl: './topic-list.html',
  styleUrl: './topic-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopicList {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  protected readonly icons = { create: LucidePlus };

  /** Every topic. `sd-list` searches, filters and sorts them in the browser. */
  protected readonly topics = rxResource({
    stream: () =>
      loadAllPages((page) => this.api.get('/topics', { query: { page, pageSize: MAX_PAGE_SIZE } })),
  });

  protected readonly error = computed(() => {
    const error = this.topics.error();
    return error instanceof ApiError ? error : null;
  });
  protected readonly failed = computed(() => this.topics.status() === 'error');
  /** Skeleton only on the first load; a reload after a save keeps the list in view. */
  protected readonly firstLoad = computed(() => this.topics.isLoading() && !this.topics.hasValue());

  protected readonly byId = (topic: Topic) => topic.id;
  protected readonly search = signal('');
  protected readonly filterValues = signal<Record<string, string>>({});
  protected readonly sort = signal<SdListSort | null>({ columnId: 'name', dir: 'asc' });

  protected readonly columns: SdListColumn<Topic>[] = [
    {
      id: 'name',
      label: 'Name',
      type: 'title',
      value: (t) => t.name,
      // A topic without an icon gets the generic one, so names line up.
      icon: (t) => topicListIcon(t.icon),
      sortable: true,
    },
    {
      id: 'description',
      label: 'Description',
      value: (t) => t.description,
      // Search matches names only, like the API's `q`.
      searchable: false,
      maxWidth: 'grow',
    },
    {
      id: 'questionnaireCount',
      label: 'Questionnaires',
      headerTitle: 'Questionnaires in the topic, active and inactive',
      value: (t) => t.questionnaireCount,
      sortable: true,
      searchable: false,
    },
    {
      id: 'status',
      label: 'Status',
      type: 'badge',
      value: (t) => STATUS_LABELS[t.status],
      tone: (t) => (t.status === 'active' ? 'success' : 'muted'),
      sortable: true,
      searchable: false,
    },
  ];

  protected readonly filters: SdListFilter<Topic>[] = [
    {
      id: 'status',
      label: 'Status',
      value: (t) => t.status,
      options: [
        { value: 'active', label: STATUS_LABELS.active },
        { value: 'inactive', label: STATUS_LABELS.inactive },
      ],
    },
  ];

  protected readonly actions: SdListAction<Topic>[] = [
    { id: 'edit', label: (t) => `Edit ${t.name}`, icon: LucidePencil },
    {
      id: 'deactivate',
      label: (t) => `Deactivate ${t.name}`,
      icon: LucidePower,
      danger: true,
      hidden: (t) => t.status !== 'active',
    },
    {
      id: 'reactivate',
      label: (t) => `Reactivate ${t.name}`,
      icon: LucideRotateCcw,
      hidden: (t) => t.status !== 'inactive',
    },
  ];

  protected readonly listLabels = {
    search: 'Search by name',
    noMatches: 'No topics match',
    noMatchesDescription: 'Try another name or clear the filters.',
    count: (shown: number, total: number) =>
      shown === total ? `${total} topics` : `${shown} of ${total} topics`,
  };

  /** The form drawer, while it is open. */
  protected readonly editing = signal<Editing | null>(null);

  /** The topic whose status is being changed, while the confirmation is open. */
  protected readonly statusTarget = signal<Topic | null>(null);
  protected readonly statusSaving = signal(false);
  protected readonly statusError = signal<string | null>(null);
  protected readonly deactivating = computed(() => this.statusTarget()?.status === 'active');

  protected create(): void {
    this.editing.set({ topic: null });
  }

  protected edit(topic: Topic): void {
    this.editing.set({ topic });
  }

  protected onAction({ action, row }: SdListActionEvent<Topic>): void {
    if (action === 'edit') this.edit(row);
    else this.askStatusChange(row);
  }

  protected onSaved(topic: Topic, wasNew: boolean): void {
    this.toasts.success(
      wasNew ? 'Topic created' : 'Topic saved',
      wasNew ? `${topic.name} is now in the list.` : `${topic.name} is up to date.`,
    );
    this.topics.reload();
  }

  protected askStatusChange(topic: Topic): void {
    this.statusError.set(null);
    this.statusTarget.set(topic);
  }

  protected async changeStatus(): Promise<void> {
    const topic = this.statusTarget();
    if (!topic || this.statusSaving()) return;
    const status = topic.status === 'active' ? 'inactive' : 'active';
    this.statusSaving.set(true);
    this.statusError.set(null);
    try {
      await firstValueFrom(
        this.api.patch('/topics/{topicId}', { path: { topicId: topic.id }, body: { status } }),
      );
      this.statusTarget.set(null);
      this.toasts.success(
        status === 'inactive' ? 'Topic deactivated' : 'Topic reactivated',
        `${topic.name} is now ${STATUS_LABELS[status].toLowerCase()}.`,
      );
      this.topics.reload();
    } catch (error) {
      this.statusError.set(saveFailedMessage(error));
    } finally {
      this.statusSaving.set(false);
    }
  }
}
