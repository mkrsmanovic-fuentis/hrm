import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  LOCALE_ID,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { LucideBell } from '@lucide/angular';
import {
  SdButton,
  SdNotificationPanel,
  SdPopoverTrigger,
  type SdNotificationItem,
} from '@specora-dev/ui-kit';
import { catchError, EMPTY, filter, firstValueFrom, interval, merge, of, switchMap } from 'rxjs';
import { ApiClient } from '../api';
import { ToastService } from '../toast';
import { toNotificationItem } from './notification-text';

/** How often the unread count is refreshed while the app is open. */
export const NOTIFICATION_REFRESH_MS = 60_000;

/**
 * The bell in the top bar, for employees: the unread count on the button, and the panel with the
 * employee's newest notifications. Opening a notification marks it as read and goes to the home
 * page, until the employee training pages exist (M4).
 *
 * The count is refreshed when the page changes and every minute; the list loads when the panel
 * opens.
 */
@Component({
  selector: 'app-notification-bell',
  imports: [SdButton, SdNotificationPanel, SdPopoverTrigger],
  templateUrl: './notification-bell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBell {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  private readonly locale = inject(LOCALE_ID);

  protected readonly icons = { bell: LucideBell };

  protected readonly unreadCount = signal(0);
  protected readonly items = signal<SdNotificationItem[]>([]);
  protected readonly loading = signal(false);
  protected readonly label = computed(() => {
    const count = this.unreadCount();
    return count > 0 ? `Notifications, ${count} unread` : 'Notifications';
  });

  constructor() {
    const pageChanges = this.router.events.pipe(filter((event) => event instanceof NavigationEnd));
    merge(of(null), pageChanges, interval(NOTIFICATION_REFRESH_MS))
      .pipe(
        switchMap(() =>
          this.api
            .get('/notifications', { query: { unread: true, pageSize: 1 } })
            // A missed refresh keeps the last count; the next one tries again.
            .pipe(catchError(() => EMPTY)),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((result) => this.unreadCount.set(result.page.totalItems));
  }

  /** Loads the newest notifications when the panel opens. */
  protected async loadList(): Promise<void> {
    this.loading.set(true);
    try {
      const result = await firstValueFrom(this.api.get('/notifications'));
      this.items.set(result.items.map((n) => toNotificationItem(n, this.locale)));
      // Loading may have added a deadline reminder, so the count may have changed.
      this.refreshCount();
    } catch {
      this.toasts.show('Notifications could not be loaded. Try again.', { tone: 'danger' });
    } finally {
      this.loading.set(false);
    }
  }

  /** Marks the notification as read and opens the home page. */
  protected async open(item: SdNotificationItem, panel: SdNotificationPanel): Promise<void> {
    panel.popover().hide();
    if (!item.read) {
      this.setRead((candidate) => candidate.id === item.id);
      this.unreadCount.update((count) => Math.max(0, count - 1));
      try {
        await firstValueFrom(
          this.api.post('/notifications/{notificationId}/read', {
            path: { notificationId: String(item.id) },
          }),
        );
      } catch {
        this.toasts.show('The notification could not be marked as read.', { tone: 'danger' });
        this.refreshCount();
      }
    }
    await this.router.navigateByUrl('/');
  }

  protected async markAllRead(): Promise<void> {
    try {
      await firstValueFrom(this.api.post('/notifications/read-all'));
      this.setRead(() => true);
      this.unreadCount.set(0);
    } catch {
      this.toasts.show('Notifications could not be marked as read. Try again.', { tone: 'danger' });
    }
  }

  private setRead(match: (item: SdNotificationItem) => boolean): void {
    this.items.update((items) =>
      items.map((item) => (match(item) ? { ...item, read: true } : item)),
    );
  }

  private refreshCount(): void {
    this.api
      .get('/notifications', { query: { unread: true, pageSize: 1 } })
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => this.unreadCount.set(result.page.totalItems));
  }
}
