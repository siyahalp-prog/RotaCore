import type { AnalyticsEvent } from './types.js';

/** Storage boundary for analytics events. PostgreSQL schema lives in @rota-core/db; ClickHouse is a future adapter. */
export type AnalyticsStore = {
  insert(event: AnalyticsEvent): Promise<void>;
  /** Returns events in [from, to) ordered by createdAt ascending. */
  findBetween(from: Date, to: Date, eventName?: string): Promise<AnalyticsEvent[]>;
};

export class InMemoryAnalyticsStore implements AnalyticsStore {
  private readonly events: AnalyticsEvent[] = [];

  async insert(event: AnalyticsEvent): Promise<void> {
    this.events.push({ ...event });
  }

  async findBetween(from: Date, to: Date, eventName?: string): Promise<AnalyticsEvent[]> {
    return this.events
      .filter(
        (e) =>
          e.createdAt >= from &&
          e.createdAt < to &&
          (eventName === undefined || e.eventName === eventName),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((e) => ({ ...e }));
  }
}
