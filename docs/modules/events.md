# Rota Events

Event-driven communication backbone for the Rota ecosystem.

## Concepts

- **Event** — `RotaEvent`: `id`, `type` (`user.registered`), `source`, optional
  `actorId`/`targetId`/`correlationId`/`idempotencyKey`, `payload`, `metadata`, `createdAt`.
- **Status lifecycle** — `pending → processing → completed | failed | dead_letter`.
- **Retry** — failed handlers reschedule the event with exponential backoff
  (`1s · 2^attempts`) until `maxAttempts` (default 5), then it moves to the
  dead letter queue.
- **Idempotency** — publishing twice with the same `idempotencyKey` throws
  `DuplicateEventError`.
- **Replay** — `replayEvent(store, id)` resets any event back to `pending`.

## Storage

- `InMemoryEventStore` — tests and local development.
- `PostgresEventStore` — production; uses `FOR UPDATE SKIP LOCKED` for safe
  concurrent claiming. Schema: `rota_events`, `rota_event_dead_letters`
  (see `packages/db`).
- Redis Streams / RabbitMQ / Kafka / NATS — future adapters behind the same
  `EventStore` interface (TODO).

## Public API

```ts
import {
  EventPublisher,
  EventConsumer,
  InMemoryEventStore,
  PostgresEventStore,
  replayEvent,
} from '@rota-core/events';

const store = new InMemoryEventStore();
const publisher = new EventPublisher(store);
const consumer = new EventConsumer(store);

consumer.on('user.registered', async (event) => {
  /* ... */
});
await publisher.publish({
  type: 'user.registered',
  source: 'rota-identity',
  actorId: 'user-1',
  idempotencyKey: 'signup-user-1',
  payload: { email: 'ada@rota.app' },
});
await consumer.processPending(); // worker loop / scheduler
```

## Example: Rota Identity

```ts
// after creating the user record
await publisher.publish({
  type: 'user.registered',
  source: 'rota-identity',
  actorId: user.id,
  idempotencyKey: `signup-${user.id}`,
  payload: { email: user.email, name: user.name },
});
```

## Example: RotaGlobal

```ts
consumer.on('scholarship.saved', async (event) => {
  await searchService.indexDocument({
    id: event.targetId!,
    type: 'scholarship',
    title: event.payload.title as string,
    content: event.payload.description as string,
    tags: ['scholarship'],
    source: 'rotaglobal',
  });
});
```

## Limitations / next steps

- Pull-based consumption only (worker loop); push transports come with the
  Redis/RabbitMQ adapters.
- `PostgresEventStore` is implemented but not yet exercised by integration
  tests against a real database.
- Per-consumer-group offsets are not implemented; all registered handlers in a
  process share one claim cycle.
