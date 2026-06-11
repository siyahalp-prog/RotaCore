import { systemClock, type Clock } from '@rota-core/core';
import { noopLogger, type Logger } from '@rota-core/logger';
import type { EventStore } from './store.js';
import type { EventHandler, ProcessResult } from './types.js';

const WILDCARD = '*';

export type ConsumerOptions = {
  clock?: Clock;
  logger?: Logger;
  /** Base delay (ms) for exponential retry backoff. Default: 1000ms. */
  retryBaseDelayMs?: number;
};

/**
 * Pull-based event consumer.
 * Register handlers per event type (or '*' for all), then call `processPending`
 * from a worker loop or scheduler. Failed events are retried with exponential
 * backoff; events that exhaust their attempts move to the dead letter queue.
 */
export class EventConsumer {
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly retryBaseDelayMs: number;

  constructor(
    private readonly store: EventStore,
    options: ConsumerOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1000;
  }

  /** Register a handler for an event type. Use '*' to receive every event. */
  on(type: string, handler: EventHandler): this {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
    return this;
  }

  registeredTypes(): string[] {
    return [...this.handlers.keys()];
  }

  /** Claim and process pending events. Returns processing statistics. */
  async processPending(limit = 10): Promise<ProcessResult> {
    const now = this.clock.now();
    const hasWildcard = this.handlers.has(WILDCARD);
    const types = hasWildcard ? undefined : [...this.handlers.keys()].filter((t) => t !== WILDCARD);

    if (!hasWildcard && (types === undefined || types.length === 0)) {
      return { claimed: 0, completed: 0, retried: 0, deadLettered: 0 };
    }

    const events = await this.store.claimPending({
      limit,
      now,
      ...(types !== undefined ? { types } : {}),
    });

    const result: ProcessResult = {
      claimed: events.length,
      completed: 0,
      retried: 0,
      deadLettered: 0,
    };

    for (const event of events) {
      const handlers = [
        ...(this.handlers.get(event.type) ?? []),
        ...(this.handlers.get(WILDCARD) ?? []),
      ];
      try {
        for (const handler of handlers) {
          await handler(event);
        }
        await this.store.update(event.id, {
          status: 'completed',
          processedAt: this.clock.now(),
          lastError: undefined,
        });
        result.completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = event.attempts + 1;
        if (attempts >= event.maxAttempts) {
          await this.store.update(event.id, {
            status: 'dead_letter',
            attempts,
            lastError: message,
          });
          await this.store.recordDeadLetter(event.id, message);
          result.deadLettered += 1;
          this.logger.error('Event moved to dead letter queue', {
            eventId: event.id,
            type: event.type,
            attempts,
          });
        } else {
          const delayMs = this.retryBaseDelayMs * 2 ** attempts;
          await this.store.update(event.id, {
            status: 'pending',
            attempts,
            lastError: message,
            nextAttemptAt: new Date(now.getTime() + delayMs),
          });
          result.retried += 1;
          this.logger.warn('Event handler failed, scheduled retry', {
            eventId: event.id,
            type: event.type,
            attempts,
            delayMs,
          });
        }
      }
    }

    return result;
  }
}
