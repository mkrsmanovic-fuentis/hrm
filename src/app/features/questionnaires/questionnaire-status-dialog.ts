import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { type ActivationProblem, ApiClient, ApiError, type Questionnaire } from '../../core/api';
import { ToastService } from '../../core/toast';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { saveFailedMessage } from '../../shared/forms/form-errors';
import { STATUS_LABELS } from './questionnaire-text';

/**
 * Asks before deactivating or activating a questionnaire, sends the `PATCH` with the new
 * `status` and confirms it with a toast. The list and the detail page share it.
 *
 * Open it by setting `questionnaire`; it closes itself after a change and emits `changed`.
 * When the API refuses, the reason stays in the dialog. A `409` from the checks before activation
 * also lists every problem, and emits `refused`, so the page can reload and show them too. The
 * pages only offer Activate when the checks pass, so this happens only when the questionnaire
 * changed since the page loaded it.
 *
 * @example
 * <app-questionnaire-status-dialog
 *   [questionnaire]="statusTarget()"
 *   (changed)="reload()"
 *   (closed)="statusTarget.set(null)"
 * />
 */
@Component({
  selector: 'app-questionnaire-status-dialog',
  imports: [ConfirmDialog],
  template: `
    <app-confirm-dialog
      [open]="questionnaire() !== null"
      [heading]="deactivating() ? 'Deactivate questionnaire?' : 'Activate questionnaire?'"
      [confirmLabel]="deactivating() ? 'Deactivate' : 'Activate'"
      [tone]="deactivating() ? 'danger' : 'primary'"
      [busy]="saving()"
      [error]="error()"
      (confirmed)="changeStatus()"
      (closed)="onClosed()"
    >
      @if (questionnaire(); as target) {
        @if (deactivating()) {
          <p class="message">
            <strong>{{ target.title }}</strong> will be marked inactive, and it can no longer be
            assigned. Employees who already have it assigned can still complete it, and all results
            are kept. You can activate it again at any time.
          </p>
        } @else {
          <p class="message">
            <strong>{{ target.title }}</strong> will be active, and it can be assigned to employees.
            Its settings and questions are unchanged.
          </p>
          @if (problems().length > 0) {
            <ul class="problems">
              @for (problem of problems(); track $index) {
                <li>{{ problem.message }}</li>
              }
            </ul>
          }
        }
      }
    </app-confirm-dialog>
  `,
  styles: `
    .message {
      margin: 0;
    }

    .problems {
      display: flex;
      flex-direction: column;
      gap: var(--sd-space-xs);
      margin: var(--sd-space-sm) 0 0;
      padding-left: var(--sd-space-lg);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionnaireStatusDialog {
  private readonly api = inject(ApiClient);
  private readonly toasts = inject(ToastService);

  /** The questionnaire whose status changes, or null while the dialog is closed. */
  readonly questionnaire = input<Questionnaire | null>(null);
  /** Fires after a successful change, with the updated questionnaire. */
  readonly changed = output<Questionnaire>();
  /** Fires when activating was refused with `409`: the questionnaire changed since it loaded. */
  readonly refused = output<readonly ActivationProblem[]>();
  /** Fires when the dialog has closed, after a change or a cancel. */
  readonly closed = output();

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Why activating was refused, from the `409`. */
  protected readonly problems = signal<readonly ActivationProblem[]>([]);
  protected readonly deactivating = computed(() => this.questionnaire()?.status === 'active');

  protected async changeStatus(): Promise<void> {
    const questionnaire = this.questionnaire();
    if (!questionnaire || this.saving()) return;
    const status = questionnaire.status === 'active' ? 'inactive' : 'active';
    this.saving.set(true);
    this.error.set(null);
    this.problems.set([]);
    try {
      const updated = await firstValueFrom(
        this.api.patch('/questionnaires/{questionnaireId}', {
          path: { questionnaireId: questionnaire.id },
          body: { status },
        }),
      );
      this.toasts.success(
        status === 'inactive' ? 'Questionnaire deactivated' : 'Questionnaire activated',
        `${questionnaire.title} is now ${STATUS_LABELS[status].toLowerCase()}.`,
      );
      this.changed.emit(updated);
      this.onClosed();
    } catch (error) {
      this.error.set(saveFailedMessage(error));
      if (error instanceof ApiError && error.activationProblems.length > 0) {
        this.problems.set(error.activationProblems);
        this.refused.emit(error.activationProblems);
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected onClosed(): void {
    this.error.set(null);
    this.problems.set([]);
    this.closed.emit();
  }
}
