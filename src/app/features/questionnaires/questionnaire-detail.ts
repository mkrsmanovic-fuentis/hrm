import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  LOCALE_ID,
  signal,
  viewChild,
} from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideArrowLeft,
  LucideClipboardList,
  LucidePencil,
  LucidePower,
  LucideRotateCcw,
  LucideSearchX,
} from '@lucide/angular';
import {
  SdButton,
  SdCallout,
  SdEmptyState,
  SdPanel,
  SdPanelSection,
  SdSkeleton,
  SdStatusBar,
  type SdBreadcrumbItem,
  type SdStatusBarStat,
} from '@specora-dev/ui-kit';
import { forkJoin, map } from 'rxjs';
import { AccessDenied } from '../../core/access';
import { ApiClient, ApiError, type Questionnaire } from '../../core/api';
import { ToastService } from '../../core/toast';
import { loadAllPages, MAX_PAGE_SIZE } from '../../shared/lists/load-all-pages';
import { QuestionEditor } from './question-editor';
import { QuestionnaireForm } from './questionnaire-form';
import { QuestionnaireStatusDialog } from './questionnaire-status-dialog';
import type { LeaveConfirmation } from './unsaved-changes.guard';
import { canActivate, passingScoreText, STATUS_LABELS, timeLimitText } from './questionnaire-text';

const LIST_URL = '/admin/questionnaires';

/**
 * One questionnaire at `/admin/questionnaires/{questionnaireId}`: its settings, with Edit
 * settings in a drawer, and Deactivate or Activate with a confirmation.
 *
 * The "Questions" section is the question editor. Leaving the page with unsaved questions asks
 * first, through `unsavedChangesGuard`.
 */
@Component({
  selector: 'app-questionnaire-detail',
  imports: [
    AccessDenied,
    QuestionEditor,
    QuestionnaireForm,
    QuestionnaireStatusDialog,
    RouterLink,
    SdButton,
    SdCallout,
    SdEmptyState,
    SdPanel,
    SdPanelSection,
    SdSkeleton,
    SdStatusBar,
  ],
  templateUrl: './questionnaire-detail.html',
  styleUrl: './questionnaire-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionnaireDetail implements LeaveConfirmation {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly locale = inject(LOCALE_ID);

  protected readonly icons = {
    back: LucideArrowLeft,
    edit: LucidePencil,
    deactivate: LucidePower,
    activate: LucideRotateCcw,
    notFound: LucideSearchX,
    questionnaire: LucideClipboardList,
  };

  private readonly questionnaireId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('questionnaireId') ?? '')),
    { initialValue: '' },
  );

  /** The questionnaire, and every topic for its topic's name and the edit form. */
  protected readonly data = rxResource({
    params: () => ({ questionnaireId: this.questionnaireId() }),
    stream: ({ params }) =>
      forkJoin({
        questionnaire: this.api.get('/questionnaires/{questionnaireId}', { path: params }),
        topics: loadAllPages((page) =>
          this.api.get('/topics', { query: { page, pageSize: MAX_PAGE_SIZE } }),
        ),
      }),
  });

  /** The loaded data; `value()` throws while the resource is in an error state. */
  private readonly loaded = computed(() => (this.data.hasValue() ? this.data.value() : null));
  protected readonly questionnaire = computed(() => this.loaded()?.questionnaire ?? null);
  protected readonly topics = computed(() => this.loaded()?.topics ?? []);
  protected readonly topic = computed(() => {
    const questionnaire = this.questionnaire();
    return this.topics().find((topic) => topic.id === questionnaire?.topicId) ?? null;
  });

  protected readonly error = computed(() => {
    const error = this.data.error();
    return error instanceof ApiError ? error : null;
  });
  protected readonly failed = computed(() => this.data.status() === 'error');
  /** Skeleton only on the first load; a reload after a save keeps the page in view. */
  protected readonly firstLoad = computed(() => this.data.isLoading() && !this.data.hasValue());

  /** The page title: the questionnaire's title once it has loaded. */
  protected readonly heading = computed(() => this.questionnaire()?.title ?? 'Questionnaire');

  protected readonly breadcrumb = computed<SdBreadcrumbItem[]>(() => [
    { label: 'Questionnaires', route: LIST_URL },
    { label: this.heading() },
  ]);

  protected readonly stats = computed<SdStatusBarStat[]>(() => {
    const q = this.questionnaire();
    if (!q) return [];
    return [
      {
        label: 'Status',
        badge: {
          label: STATUS_LABELS[q.status],
          tone: q.status === 'active' ? 'success' : 'muted',
        },
      },
      { label: 'Questions', value: String(q.questionCount) },
      { label: 'Passing score', value: passingScoreText(q.passingScore) },
      { label: 'Created', value: this.date(q.createdAt) },
    ];
  });

  /** Inactive, and missing what activating needs. */
  protected readonly activationBlocked = computed(() => {
    const q = this.questionnaire();
    return q !== null && q.status === 'inactive' && !canActivate(q);
  });

  protected readonly text = { passingScoreText, timeLimitText };

  /** The settings drawer, while it is open. */
  protected readonly editing = signal(false);
  /** The questionnaire whose status is being changed, while the confirmation is open. */
  protected readonly statusTarget = signal<Questionnaire | null>(null);

  private readonly editor = viewChild(QuestionEditor);

  /** For the route guard: the question editor asks before unsaved changes are lost. */
  confirmLeave(): boolean | Promise<boolean> {
    return this.editor()?.confirmLeave() ?? true;
  }

  protected date(value: string): string {
    return formatDate(value, 'mediumDate', this.locale);
  }

  protected back(): void {
    void this.router.navigateByUrl(LIST_URL);
  }

  protected onSaved(questionnaire: Questionnaire): void {
    this.toasts.success('Questionnaire saved', `${questionnaire.title} is up to date.`);
    this.data.reload();
  }
}
