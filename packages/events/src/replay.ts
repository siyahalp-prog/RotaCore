import { NotFoundError } from '@rota-core/core';
import type { EventStore } from './store.js';
import type { StoredEvent } from './types.js';

/**
 * Reset an event (typically dead-lettered or completed) back to `pending`
 * so consumers will pick it up again. Attempt counters are cleared.
 */
export async function replayEvent(store: EventStore, eventId: string): Promise<StoredEvent> {
  const event = await store.findById(eventId);
  if (event === null) {
    throw new NotFoundError('Event not found', { eventId });
  }
  await store.update(eventId, {
    status: 'pending',
    attempts: 0,
    lastError: undefined,
    nextAttemptAt: undefined,
    processedAt: undefined,
  });
  const replayed = await store.findById(eventId);
  return replayed as StoredEvent;
}
