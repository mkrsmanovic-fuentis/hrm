import { deadlineDay, endOfDay } from './deadline';

describe('endOfDay', () => {
  it('is 23:59:59 of the day in the local time zone, as UTC', () => {
    expect(endOfDay(new Date(2030, 0, 15))).toBe(new Date(2030, 0, 15, 23, 59, 59).toISOString());
  });
});

describe('deadlineDay', () => {
  it('is the local day a deadline falls on, so a picker shows the day that was picked', () => {
    expect(deadlineDay(endOfDay(new Date(2030, 0, 15)))).toEqual(new Date(2030, 0, 15));
  });
});
