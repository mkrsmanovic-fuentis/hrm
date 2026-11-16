/*
 * The deadline rule shared by assigning training and changing a deadline: administrators pick a
 * day, and the deadline is the end of that day in their time zone. See "Assigning training" in
 * the business rules.
 */

/** Midnight at the start of today, in the browser's time zone: the earliest day to pick. */
export function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * The deadline the API gets for a picked day: the end of that day (23:59:59) in the browser's time
 * zone, as a UTC timestamp.
 */
export function endOfDay(day: Date): string {
  const end = new Date(day);
  end.setHours(23, 59, 59, 0);
  return end.toISOString();
}

/** The day a deadline falls on, as midnight in the browser's time zone, to show it in a picker. */
export function deadlineDay(dueAt: string): Date {
  const day = new Date(dueAt);
  day.setHours(0, 0, 0, 0);
  return day;
}
