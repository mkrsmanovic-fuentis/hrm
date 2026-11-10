import { DOCUMENT } from '@angular/common';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideCheck, LucideCopy } from '@lucide/angular';
import { SdButton, SdCallout, SdField, SdInput } from '@specora-dev/ui-kit';

/** How long the copy button says "Copied". */
const COPIED_MS = 2000;

/**
 * Demo only: a link the app would have emailed, such as an invite or password reset link, shown
 * on screen with a button that copies it. Pages show it only while `environment.demo` is set.
 *
 * @example
 * <app-demo-link heading="Demo only: invite link" copyLabel="Copy invite link" [link]="link">
 *   In a real deployment, Hana gets this link by email.
 * </app-demo-link>
 */
@Component({
  selector: 'app-demo-link',
  imports: [SdButton, SdCallout, SdField, SdInput],
  template: `
    <sd-callout tone="info" role="status" [heading]="heading()">
      <div class="body">
        <p class="text"><ng-content /></p>
        <sd-field
          [label]="fieldLabel()"
          [hint]="copyFailed() ? 'Copying is blocked here. Select the link and copy it.' : null"
        >
          <input sd-input readonly [value]="link()" (focus)="selectAll($event)" />
        </sd-field>
      </div>
      <div sdCalloutActions class="actions">
        <button
          sd-button
          type="button"
          [icon]="copied() ? icons.copied : icons.copy"
          (click)="copy()"
        >
          {{ copied() ? 'Copied' : copyLabel() }}
        </button>
        @if (closable()) {
          <button sd-button variant="ghost" type="button" (click)="closed.emit()">Close</button>
        }
      </div>
    </sd-callout>
  `,
  styleUrl: './demo-link.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DemoLink {
  private readonly window = inject(DOCUMENT).defaultView;

  /** Bold first line. Say that it is for the demo only. */
  readonly heading = input.required<string>();
  /** The link to show and copy. */
  readonly link = input.required<string>();
  /** The label of the field that shows the link. */
  readonly fieldLabel = input('Link');
  /** The copy button's label, for example "Copy invite link". */
  readonly copyLabel = input('Copy link');
  /** Shows a Close button that emits `closed`. */
  readonly closable = input(false, { transform: booleanAttribute });
  readonly closed = output();

  protected readonly icons = { copy: LucideCopy, copied: LucideCheck };
  protected readonly copied = signal(false);
  protected readonly copyFailed = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  protected async copy(): Promise<void> {
    const clipboard = this.window?.navigator.clipboard;
    try {
      if (!clipboard) throw new Error('No clipboard');
      await clipboard.writeText(this.link());
      this.copyFailed.set(false);
      this.copied.set(true);
      this.clearTimer();
      this.timer = setTimeout(() => this.copied.set(false), COPIED_MS);
    } catch {
      this.copyFailed.set(true);
    }
  }

  protected selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
