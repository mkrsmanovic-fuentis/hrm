import {
  ASSIGNMENT_STATUS_LABELS,
  ASSIGNMENT_STATUS_VARIANTS,
  isPassedLate,
} from './assignment-status';

describe('assignment status display', () => {
  it('labels every status', () => {
    expect(ASSIGNMENT_STATUS_LABELS).toEqual({
      not_started: 'Not started',
      in_progress: 'In progress',
      passed: 'Passed',
      failed: 'Failed',
      overdue: 'Overdue',
    });
  });

  it('shows only Overdue in the danger tone, so it stands out', () => {
    const danger = Object.entries(ASSIGNMENT_STATUS_VARIANTS).filter(([, t]) => t === 'danger');
    expect(danger).toEqual([['overdue', 'danger']]);
    expect(ASSIGNMENT_STATUS_VARIANTS.passed).toBe('success');
  });
});

describe('isPassedLate', () => {
  const dueAt = '2026-11-10T22:59:59.000Z';

  it('is true only when the passing attempt came after the deadline', () => {
    expect(isPassedLate({ dueAt, completedAt: '2026-11-11T08:00:00.000Z' })).toBe(true);
    expect(isPassedLate({ dueAt, completedAt: '2026-11-10T08:00:00.000Z' })).toBe(false);
    expect(isPassedLate({ dueAt, completedAt: null })).toBe(false);
  });
});
