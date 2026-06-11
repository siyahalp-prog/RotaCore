import { z } from 'zod';
import { ConflictError, ValidationError, newId, systemClock, type Clock } from '@rota-core/core';
import type { RotaEvent } from '@rota-core/types';
import type { EventStore } from './store.js';
import type { PublishEventInput, StoredEvent } from './types.js';

export const publishEventSchema = z.object({
  type: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i,
      'Event type must be dot-separated, e.g. user.registered',
    ),
  source: z.string().min(1),
  actorId: z.string().min(1).optional(),
  targetId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).optional(),
  maxAttempts: z.number().int().min(1).max(20).default(5),
});

export class DuplicateEventError extends ConflictError {
  constructor(idempotencyKey: string, existingEventId: string) {
    super('Duplicate event: idempotency key already used', {
      idempotencyKey,
      existingEventId,
    });
    this.name = 'DuplicateEventError';
  }
}

export class EventPublisher {
  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Validate and persist a new event with `pending` status.
   * Rejects duplicates when an idempotency key was already used.
   */
  async publish(input: PublishEventInput): Promise<RotaEvent> {
    const parsed = publishEventSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError('Invalid event', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const data = parsed.data;

    if (data.idempotencyKey !== undefined) {
      const existing = await this.store.findByIdempotencyKey(data.idempotencyKey);
      if (existing !== null) {
        throw new DuplicateEventError(data.idempotencyKey, existing.id);
      }
    }

    const event: StoredEvent = {
      id: newId(),
      type: data.type,
      source: data.source,
      ...(data.actorId !== undefined ? { actorId: data.actorId } : {}),
      ...(data.targetId !== undefined ? { targetId: data.targetId } : {}),
      ...(data.correlationId !== undefined ? { correlationId: data.correlationId } : {}),
      ...(data.idempotencyKey !== undefined ? { idempotencyKey: data.idempotencyKey } : {}),
      payload: data.payload,
      ...(data.metadata !== undefined ? { metadata: data.metadata } : {}),
      createdAt: this.clock.now(),
      status: 'pending',
      attempts: 0,
      maxAttempts: data.maxAttempts,
    };

    await this.store.insert(event);

    const { status: _s, attempts: _a, maxAttempts: _m, ...publicEvent } = event;
    return publicEvent;
  }
}
