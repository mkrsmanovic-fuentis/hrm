import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { SdToastTone } from '@specora-dev/ui-kit';

export interface Toast {
  id: number;
  tone: SdToastTone;
  /** Bold first line. */
  heading: string | null;
  message: string;
}

export interface ToastOptions {
  tone?: SdToastTone;
  heading?: string | null;
  /** Milliseconds until it disappears on its own. `0` keeps it until it is closed. */
  durationMs?: number;
}

/** How long a toast stays, unless the caller says otherwise. */
export const TOAST_DURATION_MS = 5000;

/**
 * The queue of toasts: brief feedback after an action, such as "Department created". The shell
 * shows them in its `sd-toast-stack`; features only call `show()` or `success()`.
 *
 * @example
 * inject(ToastService).success('Department created', 'Legal is now in the list.');
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly items = signal<readonly Toast[]>([]);
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextId = 1;

  /** The toasts to show, oldest first. */
  readonly toasts = this.items.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  show(message: string, options: ToastOptions = {}): number {
    const id = this.nextId++;
    const toast: Toast = {
      id,
      tone: options.tone ?? 'info',
      heading: options.heading ?? null,
      message,
    };
    this.items.update((toasts) => [...toasts, toast]);
    const duration = options.durationMs ?? TOAST_DURATION_MS;
    if (duration > 0)
      this.timers.set(
        id,
        setTimeout(() => this.dismiss(id), duration),
      );
    return id;
  }

  /** A success toast: a heading saying what happened, and an optional sentence under it. */
  success(heading: string, message = ''): number {
    return this.show(message, { tone: 'success', heading });
  }

  dismiss(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.items.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }
}
