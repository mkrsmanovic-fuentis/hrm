import { formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  LOCALE_ID,
  type OnInit,
  output,
  signal,
} from '@angular/core';
import { disabled, form, FormField, minDate, required, submit } from '@angular/forms/signals';
import { SdButton, SdCallout, SdDatePicker, SdDialog, SdField } from '@specora-dev/ui-kit';
import { firstValueFrom } from 'rxjs';
import { ApiClient, type Assignment } from '../../core/api';
import { deadlineDay, endOfDay, startOfToday } from '../../shared/assign-training/deadline';
import { saveFailedMessage, serverFieldErrors, visibleError } from '../../shared/forms/form-errors';

interface DeadlineModel {
  deadline: Date | null;
}

/**
 * The "Change deadline" dialog: picks a new day for one assignment's deadline. The deadline is
 * the end of that day in the administrator's time zone, as when assigning. The day starts as the
 * current deadline when that is today or later, and empty when the assignment is overdue.
 *
 * The parent adds it with `@if` and removes it on `closed`. On success it emits `saved` with the
 * updated assignment and closes itself; the parent shows the toast and reloads the list.
 */
@Component({
  selector: 'app-change-deadline-dialog',
  imports: [FormField, SdButton, SdCallout, SdDatePicker, SdDialog, SdField],
  templateUrl: './change-deadline-dialog.html',
  styleUrl: './change-deadline-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeDeadlineDialog implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly locale = inject(LOCALE_ID);

  /** The assignment whose deadline changes. Never a passed one. */
  readonly assignment = input.required<Assignment>();
  /** Fires after a successful save, with the updated assignment. */
  readonly saved = output<Assignment>();
  /** Fires once the dialog has closed, after a save or a cancel. */
  readonly closed = output();

  protected readonly open = signal(true);
  protected readonly saving = signal(false);
  /** Why the last save failed, when the API named no field of the form. */
  protected readonly formError = signal<string | null>(null);

  protected readonly currentDeadline = computed(() =>
    formatDate(this.assignment().dueAt, 'mediumDate', this.locale),
  );

  /** The earliest deadline: today. */
  protected readonly today = startOfToday();

  protected readonly model = signal<DeadlineModel>({ deadline: null });
  protected readonly f = form(this.model, (p) => {
    required(p.deadline, { message: 'Choose a deadline.' });
    // Also passes the earliest day to the date picker through `[formField]`.
    minDate(p.deadline, this.today, { message: 'Choose today or a later day.' });
    disabled(p.deadline, () => this.saving());
  });

  protected readonly visibleError = visibleError;

  ngOnInit(): void {
    const day = deadlineDay(this.assignment().dueAt);
    if (day >= this.today) this.model.set({ deadline: day });
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    this.formError.set(null);
    await submit(this.f, async (form) => {
      const dueAt = endOfDay(this.model().deadline ?? this.today);
      this.saving.set(true);
      try {
        const updated = await firstValueFrom(
          this.api.patch('/assignments/{assignmentId}', {
            path: { assignmentId: this.assignment().id },
            body: { dueAt },
          }),
        );
        this.saved.emit(updated);
        this.open.set(false);
        return undefined;
      } catch (error) {
        const fieldErrors = serverFieldErrors(error, { dueAt: form.deadline });
        if (fieldErrors) return fieldErrors;
        this.formError.set(saveFailedMessage(error));
        return undefined;
      } finally {
        this.saving.set(false);
      }
    });
  }
}
