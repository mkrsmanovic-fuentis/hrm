import { formatDate } from '@angular/common';
import { LucideBookOpen, LucideCalendarClock } from '@lucide/angular';
import type { SdNotificationItem } from '@specora-dev/ui-kit';
import type { Notification } from '../api';

/**
 * The row the notification panel shows for a notification. The text comes from the type, the
 * questionnaire's title and the deadline; the time is when the notification was created.
 */
export function toNotificationItem(notification: Notification, locale: string): SdNotificationItem {
  const due = formatDate(notification.dueAt, 'mediumDate', locale);
  const reminder = notification.type === 'deadline_reminder';
  return {
    id: notification.id,
    title: reminder
      ? `Reminder: ${notification.questionnaireTitle} is due ${due}`
      : `New training: ${notification.questionnaireTitle}, due ${due}`,
    time: formatDate(notification.createdAt, 'd MMM, HH:mm', locale),
    icon: reminder ? LucideCalendarClock : LucideBookOpen,
    read: notification.readAt !== null,
  };
}
