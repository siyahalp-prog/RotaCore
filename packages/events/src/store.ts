import type { StoredEvent, EventFilter } from './types.js';

export type EventUpdate = Partial<
  Pick<StoredEvent, 'status' | 'attempts' | 'lastError' | 'nextAttemptAt' | 'processedAt'>
>;

/**
 * Storage adapter boundary for Rota Events.
 * Implementations: InMemoryEventStore (tests/dev), PostgresEventStore (production).
 * Future adapters (Redis Streams, RabbitMQ, Kafka, NATS) implement this same interface.
 */
export type EventStore = {
  insert(event: StoredEvent): Promise<void>;
  findById(id: string): Promise<StoredEvent | null>;
  findByIdempotencyKey(key: string): Promise<StoredEvent | null>;
  /** Atomically claim pending events ready for processing (marks them `processing`). */
  claimPending(options: { limit: number; now: Date; types?: string[] }): Promise<StoredEvent[]>;
  update(id: string, patch: EventUpdate): Promise<void>;
  list(filter?: EventFilter): Promise<StoredEvent[]>;
  recordDeadLetter(eventId: string, reason: string): Promise<void>;
  listDeadLetters(): Promise<{ eventId: string; reason: string; createdAt: Date }[]>;
};
