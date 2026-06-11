import { newId } from '@rota-core/core';
import type { EventStore, EventUpdate } from './store.js';
import type { StoredEvent, EventFilter } from './types.js';

/** In-memory event store for tests and local development. */
export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<string, StoredEvent>();
  private readonly deadLetters: { id: string; eventId: string; reason: string; createdAt: Date }[] =
    [];

  async insert(event: StoredEvent): Promise<void> {
    this.events.set(event.id, { ...event });
  }

  async findById(id: string): Promise<StoredEvent | null> {
    const event = this.events.get(id);
    return event !== undefined ? { ...event } : null;
  }

  async findByIdempotencyKey(key: string): Promise<StoredEvent | null> {
    for (const event of this.events.values()) {
      if (event.idempotencyKey === key) return { ...event };
    }
    return null;
  }

  async claimPending(options: {
    limit: number;
    now: Date;
    types?: string[];
  }): Promise<StoredEvent[]> {
    const claimed: StoredEvent[] = [];
    const sorted = [...this.events.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (const event of sorted) {
      if (claimed.length >= options.limit) break;
      if (event.status !== 'pending') continue;
      if (event.nextAttemptAt !== undefined && event.nextAttemptAt > options.now) continue;
      if (options.types !== undefined && !options.types.includes(event.type)) continue;
      event.status = 'processing';
      claimed.push({ ...event });
    }
    return claimed;
  }

  async update(id: string, patch: EventUpdate): Promise<void> {
    const event = this.events.get(id);
    if (event === undefined) return;
    Object.assign(event, patch);
  }

  async list(filter: EventFilter = {}): Promise<StoredEvent[]> {
    let results = [...this.events.values()];
    if (filter.type !== undefined) results = results.filter((e) => e.type === filter.type);
    if (filter.status !== undefined) results = results.filter((e) => e.status === filter.status);
    if (filter.correlationId !== undefined)
      results = results.filter((e) => e.correlationId === filter.correlationId);
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results.slice(0, filter.limit ?? 100).map((e) => ({ ...e }));
  }

  async recordDeadLetter(eventId: string, reason: string): Promise<void> {
    this.deadLetters.push({ id: newId(), eventId, reason, createdAt: new Date() });
  }

  async listDeadLetters(): Promise<{ eventId: string; reason: string; createdAt: Date }[]> {
    return this.deadLetters.map(({ eventId, reason, createdAt }) => ({
      eventId,
      reason,
      createdAt,
    }));
  }
}
