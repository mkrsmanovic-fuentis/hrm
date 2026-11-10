import { TestBed } from '@angular/core/testing';
import { TOAST_DURATION_MS, ToastService } from './toast.service';

describe('ToastService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a success toast and removes it after a while', () => {
    const toasts = TestBed.inject(ToastService);

    toasts.success('Department created', 'Legal is now in the list.');

    expect(toasts.toasts()).toEqual([
      {
        id: expect.any(Number),
        tone: 'success',
        heading: 'Department created',
        message: 'Legal is now in the list.',
      },
    ]);
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(toasts.toasts()).toEqual([]);
  });

  it('keeps toasts in order and dismisses one on request', () => {
    const toasts = TestBed.inject(ToastService);

    const first = toasts.show('One');
    toasts.show('Two', { tone: 'danger', durationMs: 0 });
    toasts.dismiss(first);

    expect(toasts.toasts().map((toast) => [toast.message, toast.tone])).toEqual([
      ['Two', 'danger'],
    ]);
    vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    expect(toasts.toasts()).toHaveLength(1);
  });
});
