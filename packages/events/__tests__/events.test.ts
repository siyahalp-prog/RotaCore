import { describe, expect, it } from 'vitest';
import type { Clock } from '@rota-core/core';
import {
  DuplicateEventError,
  EventConsumer,
  EventPublisher,
  InMemoryEventStore,
  replayEvent,
} from '../src/index.js';

function fixedClock(
  start = new Date('2026-01-01T00:00:00Z'),
): Clock & { advance(ms: number): void } {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

function setup() {
  const clock = fixedClock();
  const store = new InMemoryEventStore();
  const publisher = new EventPublisher(store, clock);
  const consumer = new EventConsumer(store, { clock });
  return { clock, store, publisher, consumer };
}

describe('Rota Events', () => {
  it('publishes an event', async () => {
    const { store, publisher } = setup();
    const event = await publisher.publish({
      type: 'user.registered',
      source: 'rota-identity',
      actorId: 'user-1',
      payload: { email: 'test@example.com' },
    });

    expect(event.id).toBeTruthy();
    expect(event.type).toBe('user.registered');
    const stored = await store.findById(event.id);
    expect(stored?.status).toBe('pending');
  });

  it('rejects invalid events', async () => {
    const { publisher } = setup();
    await expect(
      publisher.publish({ type: 'not a valid type!!', source: 'test' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('consumes an event', async () => {
    const { publisher, consumer, store } = setup();
    const received: string[] = [];
    consumer.on('user.registered', (event) => {
      received.push(event.payload['email'] as string);
    });

    const event = await publisher.publish({
      type: 'user.registered',
      source: 'rota-identity',
      payload: { email: 'a@rota.app' },
    });
    const result = await consumer.processPending();

    expect(result).toMatchObject({ claimed: 1, completed: 1 });
    expect(received).toEqual(['a@rota.app']);
    expect((await store.findById(event.id))?.status).toBe('completed');
  });

  it('retries failed events with backoff', async () => {
    const { clock, publisher, consumer, store } = setup();
    let calls = 0;
    consumer.on('post.created', () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary failure');
    });

    const event = await publisher.publish({ type: 'post.created', source: 'rotaglobal' });

    const first = await consumer.processPending();
    expect(first.retried).toBe(1);
    const afterFail = await store.findById(event.id);
    expect(afterFail?.status).toBe('pending');
    expect(afterFail?.attempts).toBe(1);
    expect(afterFail?.lastError).toBe('temporary failure');

    // Not yet due for retry
    const tooEarly = await consumer.processPending();
    expect(tooEarly.claimed).toBe(0);

    clock.advance(60_000);
    const second = await consumer.processPending();
    expect(second.completed).toBe(1);
    expect((await store.findById(event.id))?.status).toBe('completed');
  });

  it('moves exhausted events to the dead letter queue', async () => {
    const { clock, publisher, consumer, store } = setup();
    consumer.on('message.sent', () => {
      throw new Error('permanent failure');
    });

    const event = await publisher.publish({
      type: 'message.sent',
      source: 'rotaglobal',
      maxAttempts: 2,
    });

    await consumer.processPending();
    clock.advance(60_000);
    const result = await consumer.processPending();

    expect(result.deadLettered).toBe(1);
    expect((await store.findById(event.id))?.status).toBe('dead_letter');
    const deadLetters = await store.listDeadLetters();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]?.eventId).toBe(event.id);
    expect(deadLetters[0]?.reason).toBe('permanent failure');
  });

  it('replays dead-lettered events', async () => {
    const { clock, publisher, consumer, store } = setup();
    let shouldFail = true;
    consumer.on('scholarship.saved', () => {
      if (shouldFail) throw new Error('downstream offline');
    });

    const event = await publisher.publish({
      type: 'scholarship.saved',
      source: 'rotaglobal',
      maxAttempts: 1,
    });
    await consumer.processPending();
    expect((await store.findById(event.id))?.status).toBe('dead_letter');

    shouldFail = false;
    const replayed = await replayEvent(store, event.id);
    expect(replayed.status).toBe('pending');
    expect(replayed.attempts).toBe(0);

    clock.advance(1);
    const result = await consumer.processPending();
    expect(result.completed).toBe(1);
    expect((await store.findById(event.id))?.status).toBe('completed');
  });

  it('rejects duplicate idempotency keys', async () => {
    const { publisher } = setup();
    await publisher.publish({
      type: 'user.registered',
      source: 'rota-identity',
      idempotencyKey: 'signup-user-1',
    });

    await expect(
      publisher.publish({
        type: 'user.registered',
        source: 'rota-identity',
        idempotencyKey: 'signup-user-1',
      }),
    ).rejects.toBeInstanceOf(DuplicateEventError);
  });
});
