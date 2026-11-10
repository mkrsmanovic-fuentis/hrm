import type { Attempt } from '../../app/core/api/api-schema.gen';
import { assignmentStatus, isPassing, minimumCorrectToPass, scoreOf } from './training-rules';

describe('training rules', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const future = '2026-11-20T12:00:00Z';
  const past = '2026-11-01T12:00:00Z';

  function attempt(attemptNumber: number, state: 'open' | 'pass' | 'fail'): Attempt {
    return {
      attemptNumber,
      status: state === 'open' ? 'in_progress' : 'submitted',
      passed: state === 'open' ? null : state === 'pass',
    } as Attempt;
  }

  describe('assignmentStatus', () => {
    it('is not started without attempts', () => {
      expect(assignmentStatus(future, [], now)).toBe('not_started');
    });

    it('is in progress while the latest attempt is open', () => {
      expect(assignmentStatus(future, [attempt(1, 'fail'), attempt(2, 'open')], now)).toBe(
        'in_progress',
      );
    });

    it('is failed when the latest attempt failed', () => {
      expect(assignmentStatus(future, [attempt(1, 'fail')], now)).toBe('failed');
    });

    it('is overdue after the deadline, before failed or in progress', () => {
      expect(assignmentStatus(past, [], now)).toBe('overdue');
      expect(assignmentStatus(past, [attempt(1, 'fail')], now)).toBe('overdue');
      expect(assignmentStatus(past, [attempt(1, 'open')], now)).toBe('overdue');
    });

    it('is passed when any attempt passed, even after the deadline', () => {
      expect(assignmentStatus(past, [attempt(1, 'fail'), attempt(2, 'pass')], now)).toBe('passed');
    });
  });

  describe('scoring', () => {
    it('compares the exact score, so 79.6% fails at 80%', () => {
      expect(isPassing(79.6, 80)).toBe(false);
      expect(isPassing(80, 80)).toBe(true);
    });

    it('scores correct answers as a share of all questions', () => {
      expect(scoreOf(4, 5)).toBe(80);
      expect(scoreOf(2, 3)).toBeCloseTo(66.667, 2);
    });

    it('knows the fewest correct answers that pass', () => {
      expect(minimumCorrectToPass(5, 80)).toBe(4);
      expect(minimumCorrectToPass(5, 70)).toBe(4);
      expect(minimumCorrectToPass(5, 90)).toBe(5);
      expect(minimumCorrectToPass(4, 75)).toBe(3);
    });
  });
});
