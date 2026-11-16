import { formatDate } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { createTestMockApi, TEST_NOW, type TestMockApiOptions } from '../../../mocks/testing';
import { ToastService } from '../toast';
import { NOTIFICATION_REFRESH_MS, NotificationBell } from './notification-bell';

@Component({ template: '' })
class Blank {}

describe('Notification bell', () => {
  // jsdom has no Popover API; the panel closes itself through it after a notification is opened.
  const hidePopover = HTMLElement.prototype.hidePopover;
  beforeAll(() => {
    HTMLElement.prototype.hidePopover ??= () => undefined;
  });
  afterAll(() => {
    HTMLElement.prototype.hidePopover = hidePopover;
  });
  afterEach(() => vi.useRealTimers());

  async function render(options: TestMockApiOptions = { signedInAs: 'employee' }) {
    const mock = createTestMockApi(options);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: Blank },
          { path: 'other', component: Blank },
        ]),
        provideHttpClient(),
        ...mock.providers,
      ],
    });
    const fixture = TestBed.createComponent(NotificationBell);
    const element = fixture.nativeElement as HTMLElement;
    const employee = mock.db.data.users.find((u) => u.role === 'employee' && u.status === 'active');
    if (!employee) throw new Error('No active employee in the seed');
    const own = () => mock.db.data.notifications.filter((n) => n.userId === employee.id);
    const unread = () => own().filter((n) => n.readAt === null).length;
    const bell = () => element.querySelector<HTMLButtonElement>('button[sd-button]');
    const label = () => bell()?.getAttribute('aria-label');
    const rows = () => [
      ...element.querySelectorAll<HTMLElement>('sd-notification-panel [role="button"]'),
    ];
    const settle = async () => {
      await fixture.whenStable();
      await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).toBeNull());
      await fixture.whenStable();
    };
    const openPanel = async () => {
      bell()?.click();
      await settle();
      await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));
    };
    await settle();
    return { fixture, element, mock, employee, own, unread, label, rows, settle, openPanel };
  }

  it('shows the unread count on the bell', async () => {
    const { label, unread, mock, employee, settle } = await render();
    // Give the employee a known number of unread notifications.
    mock.db.update((data) =>
      data.notifications
        .filter((n) => n.userId === employee.id)
        .forEach((n, i) => (n.readAt = i < 2 ? null : TEST_NOW.toISOString())),
    );
    TestBed.inject(Router).navigateByUrl('/other');
    await settle();

    await vi.waitFor(() => expect(label()).toBe('Notifications, 2 unread'));
    expect(unread()).toBe(2);
  });

  it('lists the newest notifications first, with text built from the type', async () => {
    const { openPanel, rows, own, mock } = await render();
    await openPanel();

    const newest = [...own()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const assignment = mock.db.data.assignments.find((a) => a.id === newest.assignmentId);
    const questionnaire = mock.db.data.questionnaires.find(
      (q) => q.id === assignment?.questionnaireId,
    );
    const due = formatDate(assignment?.dueAt ?? '', 'mediumDate', 'en-US');
    const expected =
      newest.type === 'deadline_reminder'
        ? `Reminder: ${questionnaire?.title} is due ${due}`
        : `New training: ${questionnaire?.title}, due ${due}`;
    expect(rows()[0].textContent).toContain(expected);
    expect(rows()).toHaveLength(Math.min(own().length, 25));
  });

  it('marks an unread notification as read when it is opened, and goes to the home page', async () => {
    const { openPanel, rows, own, mock, employee, label, fixture } = await render();
    mock.db.update((data) =>
      data.notifications.filter((n) => n.userId === employee.id).forEach((n) => (n.readAt = null)),
    );
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/other');
    await openPanel();
    const total = own().length;
    await vi.waitFor(() => expect(label()).toBe(`Notifications, ${total} unread`));

    rows()[0].click();
    await fixture.whenStable();

    await vi.waitFor(() => expect(own().filter((n) => n.readAt !== null)).toHaveLength(1));
    await vi.waitFor(() => expect(router.url).toBe('/'));
    await vi.waitFor(() => expect(label()).toBe(`Notifications, ${total - 1} unread`));
  });

  it('marks every notification as read with Mark all as read', async () => {
    const { openPanel, element, own, mock, employee, label, fixture } = await render();
    mock.db.update((data) =>
      data.notifications.filter((n) => n.userId === employee.id).forEach((n) => (n.readAt = null)),
    );
    await openPanel();

    const markAll = [...element.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Mark all as read',
    );
    markAll?.click();
    await fixture.whenStable();

    await vi.waitFor(() => expect(own().every((n) => n.readAt !== null)).toBe(true));
    await vi.waitFor(() => expect(label()).toBe('Notifications'));
  });

  it('refreshes the unread count every minute', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { label, mock, employee } = await render();
    mock.db.update((data) =>
      data.notifications
        .filter((n) => n.userId === employee.id)
        .forEach((n, i) => (n.readAt = i === 0 ? null : TEST_NOW.toISOString())),
    );

    vi.advanceTimersByTime(NOTIFICATION_REFRESH_MS);

    await vi.waitFor(() => expect(label()).toBe('Notifications, 1 unread'));
  });

  it('tells the employee when the notifications could not be loaded', async () => {
    const { element, fixture } = await render({
      signedInAs: 'employee',
      flags: { errorStatus: 500, scope: '/notifications' },
    });

    element.querySelector<HTMLButtonElement>('button[sd-button]')?.click();
    await fixture.whenStable();

    const toasts = TestBed.inject(ToastService);
    await vi.waitFor(() =>
      expect(toasts.toasts()[0]?.message).toBe('Notifications could not be loaded. Try again.'),
    );
  });
});
