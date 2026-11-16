import { needsDeadlineReminder } from './notification-rules';

const NOW = new Date('2026-11-10T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('needsDeadlineReminder', () => {
  const dueIn = (ms: number) => ({ id: 'a1', dueAt: new Date(NOW.getTime() + ms).toISOString() });
  const assignment = dueIn(2 * DAY);
  const active = { status: 'active' as const };

  it('is due within the last 3 days before the deadline', () => {
    expect(needsDeadlineReminder(assignment, active, [], [], NOW)).toBe(true);
    expect(needsDeadlineReminder(dueIn(3 * DAY), active, [], [], NOW)).toBe(true);
  });

  it('is not due for an inactive employee', () => {
    expect(needsDeadlineReminder(assignment, { status: 'inactive' }, [], [], NOW)).toBe(false);
  });

  it('is not due once the assignment is passed', () => {
    const attempts = [{ assignmentId: 'a1', passed: true }];
    expect(needsDeadlineReminder(assignment, active, attempts, [], NOW)).toBe(false);
  });

  it('is still due after a failed attempt', () => {
    const attempts = [{ assignmentId: 'a1', passed: false }];
    expect(needsDeadlineReminder(assignment, active, attempts, [], NOW)).toBe(true);
  });

  it('is not due twice for the same assignment', () => {
    const sent = [{ assignmentId: 'a1', type: 'deadline_reminder' as const }];
    expect(needsDeadlineReminder(assignment, active, [], sent, NOW)).toBe(false);
    const created = [{ assignmentId: 'a1', type: 'assignment_created' as const }];
    expect(needsDeadlineReminder(assignment, active, [], created, NOW)).toBe(true);
  });

  it('is not due again after the deadline changes', () => {
    // The reminder was sent for the old deadline; the new one is again within 3 days.
    const sent = [{ assignmentId: 'a1', type: 'deadline_reminder' as const }];
    expect(needsDeadlineReminder(dueIn(DAY), active, [], sent, NOW)).toBe(false);
  });

  it('is not due when the deadline has passed or is more than 3 days away', () => {
    expect(needsDeadlineReminder(dueIn(-1), active, [], [], NOW)).toBe(false);
    expect(needsDeadlineReminder(dueIn(3 * DAY + 1), active, [], [], NOW)).toBe(false);
  });
});
