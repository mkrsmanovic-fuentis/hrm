import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SdButton, SdCallout } from '@specora-dev/ui-kit';
import { type AssignTrainingResult, SKIP_REASON_TEXT } from './assign-training-result';

/**
 * The employees skipped by the last "Assign training", by name and with the reason, above the
 * page's content until closed. Shows nothing when no one was skipped.
 */
@Component({
  selector: 'app-assign-result',
  imports: [SdButton, SdCallout],
  template: `
    @if (result(); as r) {
      @if (r.skipped.length > 0) {
        <sd-callout tone="warning" role="status" [heading]="heading()">
          <div class="body">
            <p class="intro">
              {{ r.questionnaireTitle }} was not assigned again to these employees:
            </p>
            <ul class="names">
              @for (employee of r.skipped; track employee.userId) {
                <li>
                  <strong>{{ employee.name }}</strong>
                  · {{ reasons[employee.reason] }}
                </li>
              }
            </ul>
          </div>
          <button sdCalloutActions sd-button type="button" (click)="closed.emit()">Close</button>
        </sd-callout>
      }
    }
  `,
  styles: `
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--sd-space-xs);
    }

    .intro,
    .names {
      margin: 0;
    }

    .names {
      padding-inline-start: var(--sd-space-lg);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssignResult {
  /** The last result, or null when there is nothing to show. */
  readonly result = input<AssignTrainingResult | null>(null);
  /** The administrator closed the list. */
  readonly closed = output();

  protected readonly reasons = SKIP_REASON_TEXT;
  protected readonly heading = computed(() => {
    const count = this.result()?.skipped.length ?? 0;
    return count === 1 ? '1 employee skipped' : `${count} employees skipped`;
  });
}
