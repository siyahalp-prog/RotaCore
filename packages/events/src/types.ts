import type { EventStatus, RotaEvent } from '@rota-core/types';

/** Event with delivery/processing state, as stored by an EventStore. */
export type StoredEvent = RotaEvent & {
  status: EventStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string | undefined;
  nextAttemptAt?: Date | undefined;
  processedAt?: Date | undefined;
};

export type EventHandler = (event: RotaEvent) => Promise<void> | void;

export type PublishEventInput = {
  type: string;
  source: string;
  actorId?: string;
  targetId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  maxAttempts?: number;
};

export type EventFilter = {
  type?: string;
  status?: EventStatus;
  correlationId?: string;
  limit?: number;
};

export type ProcessResult = {
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
};
