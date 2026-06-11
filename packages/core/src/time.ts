/** Clock abstraction so modules stay testable. */
export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

export function startOfDayUtc(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function dayKeyUtc(date: Date): string {
  return startOfDayUtc(date).toISOString().slice(0, 10);
}

export function daysAgo(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}
