import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { SdButton, SdCallout, SdDialog } from '@specora-dev/ui-kit';

/**
 * Asks before an action that changes data, such as deactivating a record: `sd-dialog` with the
 * message, an error callout and Cancel and confirm buttons. The parent runs the action on
 * `confirmed`, sets `busy` while it runs, and closes the dialog (`open` to false) when it is
 * done, or sets `error` when it failed. While busy, the dialog cannot be closed.
 *
 * @example
 * <app-confirm-dialog
 *   [open]="target() !== null"
 *   heading="Deactivate department?"
 *   confirmLabel="Deactivate"
 *   tone="danger"
 *   [busy]="saving()"
 *   [error]="error()"
 *   (confirmed)="deactivate()"
 *   (closed)="target.set(null)"
 * >
 *   <p>Its history is kept.</p>
 * </app-confirm-dialog>
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [SdButton, SdCallout, SdDialog],
  template: `
    <sd-dialog
      size="sm"
      [heading]="heading()"
      [(open)]="open"
      [dismissable]="!busy()"
      [closable]="!busy()"
      (closed)="closed.emit()"
    >
      <div class="body">
        @if (error(); as error) {
          <sd-callout tone="danger" role="alert">{{ error }}</sd-callout>
        }
        <ng-content />
      </div>
      <ng-container sdDialogFooter>
        <button sd-button type="button" [disabled]="busy()" (click)="open.set(false)">
          {{ cancelLabel() }}
        </button>
        @if (confirmable()) {
          <button
            sd-button
            type="button"
            [variant]="tone()"
            [loading]="busy()"
            [disabled]="busy()"
            (click)="confirmed.emit()"
          >
            {{ confirmLabel() }}
          </button>
        }
      </ng-container>
    </sd-dialog>
  `,
  styles: `
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--sd-space-md);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialog {
  readonly open = model(false);
  readonly heading = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly cancelLabel = input('Cancel');
  /** `danger` for an action that takes something away, such as deactivating. */
  readonly tone = input<'primary' | 'danger'>('primary');
  /** The action is running: the confirm button spins and the dialog stays open. */
  readonly busy = input(false);
  /** Why the action failed, shown above the message. */
  readonly error = input<string | null>(null);
  /**
   * Whether the action can still be confirmed. Set it to false when the action can no longer
   * work, for example after the API refused it for a reason the dialog shows: only the cancel
   * button stays, so give it a label such as "Close".
   */
  readonly confirmable = input(true);

  /** The confirm button was clicked. */
  readonly confirmed = output();
  /** The dialog closed, however it was closed. */
  readonly closed = output();
}
