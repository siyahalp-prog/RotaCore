# RotaCore – Full Architecture Review
> Reviewed: 2026-06-11 | Scope: all packages & apps

---

## 1. Monorepo Structure

```
RotaCore/
├── apps/
│   ├── api/          ← Fastify HTTP surface (2 files, ~5 KB)
│   ├── admin/        ← placeholder (README only)
│   └── docs-site/    ← placeholder
├── packages/
│   ├── types         ← shared primitives (leaf node)
│   ├── core          ← errors, ids, time, api-response helpers
│   ├── logger        ← zero-dep JSON logger
│   ├── config        ← env validation (Zod)
│   ├── db            ← SqlClient interface + SQL schemas
│   ├── events        ← publisher, consumer, stores, replay
│   ├── notifications ← service, store, providers, templates
│   ├── analytics     ← service, store, tracking script
│   ├── search        ← service, adapters (in-memory + postgres)
│   ├── monitoring    ← health, errors, latency, alerts, logs, dashboard
│   ├── feature-flags ← client, evaluate, store
│   ├── workflows     ← engine, types
│   └── sdk           ← facade: wires everything into RotaCore object
└── scripts/          ← clean.mjs helper
```

**Assessment: ✅ Excellent**

The structure is clean, intentional, and well-layered. Every package has a focused responsibility. The `sdk` package as a composition root / facade is a good pattern for product teams consuming this. The leaf → domain → facade dependency direction is maintained correctly.

**Minor gap:** `apps/admin` and `apps/docs-site` are shells — they exist in the tree but contain no code (admin has a README only). They imply future intent but add noise until populated.

---

## 2. Package Boundaries & Dependency Graph

```
types ← core ← logger, config, db
           ↑
      events ← notifications
           ↑
      analytics, search, monitoring, feature-flags, workflows
           ↑
          sdk  ←  api
```

**Assessment: ✅ Mostly clean — one structural concern**

| Finding | Severity |
|---|---|
| `@rota-core/events` lists `@rota-core/db` as a **runtime** dependency even though it only needs it for `PostgresEventStore`. The `InMemoryEventStore` (the only store used at runtime today) has no DB requirement. | 🟡 Medium |
| `@rota-core/notifications` directly imports `@rota-core/events` (for `EventConsumer` type) to wire `event-integration.ts`. This creates a coupling between notifications and the event bus — it breaks if events is refactored. | 🟡 Medium |
| `@rota-core/sdk` re-exports every module with `export * from ...` (lines 107–114). This creates a massive barrel that could silently re-export name collisions as the codebase grows. | 🟡 Medium |
| `WorkflowEngine` imports `EventConsumer` type from `@rota-core/events` (for `bindToConsumer`). This is an acceptable optional dependency, but it couples the engine to the events transport. | 🟢 Low |
| No circular dependencies detected. | ✅ |

**Recommended fix for `events` ↔ `db`:** Move `PostgresEventStore` out of `packages/events` into a new `packages/postgres-stores` (or similar) package. Each module's Postgres adapter can live there, keeping the domain packages DB-free and making the `db` dependency optional via adapters only.

---

## 3. Module Coupling

### Tight couplings

| Location | Coupled to | Risk |
|---|---|---|
| `notifications/event-integration.ts` hardcodes event types (`user.registered`, `user.password_changed`, `post.comment.created`) as string literals | `events` domain model | Breaking rename = silent failure |
| `sdk/index.ts` constructs every service imperatively — any new service requires editing the SDK | all packages | Low (single file) but grow risk |
| `app.ts` uses `core.events.publisher.publish(request.body as Parameters<...>[0])` — casting raw request body directly to a typed parameter | API ↔ events | No runtime schema validation at HTTP boundary (only Zod inside the service) |
| `WorkflowEngine.bindToConsumer()` must be called manually after adding workflows — easy to miss | workflows ↔ events | Integration coupling, no enforcement |

### Loose couplings (well done)

- `EventStore`, `NotificationStore`, `SearchAdapter`, `FlagStore` are all pure interfaces — adapters are swappable.
- `Clock` injection throughout means every time-sensitive module is fully testable.
- `Logger` is an interface; every package defaults to `noopLogger` so there's zero forced output in tests.
- `EmailProvider` interface isolates the delivery mechanism.

---

## 4. Event-Driven Architecture Quality

### Assessment: ✅ Solid foundation, 🟡 some gaps for production scale

**What works well:**

| Feature | Implementation |
|---|---|
| Durable event storage | `EventStore` with `pending → processing → completed/dead_letter` state machine |
| Idempotency | `idempotencyKey` checked before insert; `DuplicateEventError` thrown |
| Exponential backoff | `retryBaseDelayMs * 2^attempts` with configurable base |
| Dead letter queue | `recordDeadLetter` + `listDeadLetters()` in both adapters |
| Event replay | `replayEvent()` resets state to `pending` with attempt counter cleared |
| Concurrency safety (Postgres) | `FOR UPDATE SKIP LOCKED` correctly prevents double-processing |
| Wildcard handler | `consumer.on('*', handler)` supported |
| Correlation IDs | Threaded from events → notifications → deliveries |

**Gaps:**

| Gap | Severity | Detail |
|---|---|---|
| **In-process polling loop** in `server.ts` uses `setInterval(1000)` | 🔴 Critical | Single-threaded; if handler takes >1 s, events queue up. No way to scale consumers horizontally without external locking. Works fine for single-node dev but not production under load. |
| **No event schema registry** | 🟡 Medium | Event `type` is a free-form string with a regex check. There's no registry of known event types and their payload shapes. A `user.registered` event can carry any payload — typos and drift go undetected at publish time. |
| **Consumer handlers run sequentially** | 🟡 Medium | `for (const handler of handlers) { await handler(event); }` — all handlers for one event type run one after another. If handler A is slow, handler B is delayed. |
| **No event ordering guarantee** | 🟢 Low | By-`created_at` FIFO ordering is best-effort; parallel consumers could process out of order. Document this contract. |
| **`processing` status is never cleaned up** | 🟡 Medium | If the server crashes mid-processing, events remain stuck in `processing` status permanently. Need a "claim timeout" / re-queue mechanism. |
| **Notification delivery is synchronous** | 🟡 Medium | `deliver()` is called directly inside `createNotification()`. Email sends block the notification creation. This should be async / queued. |

---

## 5. Over-Engineering Risks

**Assessment: 🟢 Low overall — remarkably un-over-engineered for the scope**

The codebase is disciplined. There are no unnecessary abstractions. A few observations:

| Potential concern | Verdict |
|---|---|
| 13 packages for an internal platform | **Justified** — each package is independently testable and can be consumed without the full SDK. Clean separation of concerns. |
| `WorkflowEngine` mini-automation engine | **Premature for v0.1** if no products are using it yet. It adds ~300 lines of code (engine + types + tests) for a feature that could be deferred. However it's well-isolated, so the cost is contained. |
| `AnalyticsService.funnel()` method | **Potentially premature** — 35-line funnel analysis in the platform layer; most analytics products use a dedicated tool. Worth deferring to a dedicated analytics service. |
| `LogIngestion` class | **Mild redundancy** — it collects logs in memory alongside the structured logger. The use case (shipping logs to monitoring) is valid, but without a Postgres adapter or real sink, it's an in-memory array that gets discarded on restart. |
| `InMemorySearchLogStore` defined inside `search/service.ts` | **Minor smell** — mixing two responsibilities in one file. `InMemorySearchLogStore` should live in its own file or alongside the in-memory adapter. |
| SDK `export * from '@rota-core/...'` barrel | **Manageable now**, will need attention as the monorepo grows (name collisions, tree-shaking issues). |

---

## 6. Production Readiness

**Assessment: 🔴 Not yet production-ready — multiple critical gaps**

| Area | Status | Notes |
|---|---|---|
| **Authentication / Authorization** | ❌ Missing | The API has zero authentication. `/admin/dashboard`, `/admin/events`, `/flags/:key` (write) are all unauthenticated. |
| **Input validation at HTTP boundary** | 🟡 Partial | Events and analytics validate inside the service (Zod). `/errors POST` body fields (`service`, `message`, `stack`) have no validation — any string accepted. `/search`, `/flags/:key` accept raw query strings without type coercion/validation. |
| **Rate limiting** | ❌ Missing | No rate limiting on `/track`, `/events`, or the admin endpoints. |
| **CORS** | ❌ Missing | Fastify started without CORS plugin. `/track.js` would be served to browsers with no CORS headers. |
| **Request body size limits** | 🟡 Default only | Fastify defaults to 1 MB — acceptable but not documented or configurable. |
| **Database migration strategy** | ❌ Missing | `applySchema()` in `db/index.ts` runs `CREATE TABLE IF NOT EXISTS` — no versioned migrations. Schema changes can't be rolled back or tracked. |
| **Postgres adapters for most modules** | 🟡 Partial | Only `events` and `search` have Postgres adapters. `notifications`, `analytics`, `monitoring`, `feature-flags`, `workflows` are in-memory-only. Everything is lost on restart. |
| **`processing` status leak** | 🔴 Critical | (described above) — events stuck on crash. |
| **`SmtpEmailProvider` throws NOT_IMPLEMENTED** | 🔴 Critical | The only "real" email provider throws an error by design. There's no production email path. |
| **Secrets / environment validation** | ✅ Good | `loadEnv` + Zod schema on startup. `DATABASE_URL` and `REDIS_URL` are optional, which is correct for local dev. |
| **Graceful shutdown** | ❌ Missing | `server.ts` doesn't handle `SIGTERM`/`SIGINT`. The poll interval is `.unref()`-ed (won't block exit) but in-flight handlers aren't awaited. |
| **Health check coverage** | 🟡 Partial | `api` check is registered (`ok: true` always). No DB connectivity check registered even when `DATABASE_URL` is set. |
| **Structured logging in Fastify** | 🟡 Degraded | `Fastify({ logger: false })` — request logs are disabled. Latency is tracked manually but standard request/response logging is off. |
| **Error stack exposure** | ✅ Scrubbed | `toApiFailure` correctly hides internal details; non-`RotaError` exceptions produce a generic message. |

---

## 7. Maintainability

**Assessment: ✅ High — the codebase is readable and consistent**

**Positives:**
- Consistent code style (Prettier + ESLint enforced).
- Every class accepts an options bag instead of positional args — forward-compatible.
- `Clock` injection is a textbook pattern for testability.
- All public surfaces have JSDoc comments explaining intent.
- The `@rota-core/core` package correctly centralises cross-cutting concerns (errors, ids, time, API envelopes).
- SQL schemas live in `@rota-core/db` — a single place for all DDL.

**Areas for improvement:**
- Event type strings are bare string literals scattered across `event-integration.ts`. A centralised `EventTypes` const/enum prevents typos.
- `NotificationService.deliver()` is a 30-line private method with multiple channel `if/else if` branches. As channels grow, this should be a strategy map/registry.
- `AnalyticsService` has multiple `findBetween` calls per analytics query (each of `topPages`, `topReferrers`, `eventsByName` fetches the full event list independently). A single aggregation pass would be more efficient.
- `WorkflowEngine.bindToConsumer()` is a footgun: registering new workflows after calling `bind` won't pick up the new trigger types. This subtle requirement isn't documented.
- No `CHANGELOG.md` — given this is a platform layer consumed by multiple products, change tracking is important.

---

## 8. Test Coverage

**Assessment: 🟡 Good for core paths, sparse for supporting packages**

| Package | Test file | Coverage assessment |
|---|---|---|
| `@rota-core/core` | `core.test.ts` (50 lines) | Covers: error classes, API envelopes, ID generation, hashing, day keys. **Missing:** `toApiFailure` with `correlationId`, clock edge cases. |
| `@rota-core/events` | `events.test.ts` (167 lines) | ✅ Best coverage: publish, consume, retry backoff, dead-letter, replay, idempotency. **Missing:** wildcard handler, `list()` with filters, concurrent claim. |
| `@rota-core/notifications` | `notifications.test.ts` (4.8 KB) | Likely covers basic notification creation. Needs verification of preference skipping, delivery failure path, template rendering. |
| `@rota-core/workflows` | `workflows.test.ts` (5.1 KB) | Likely covers happy path + step retry. Needs edge cases. |
| `@rota-core/api` | `api.test.ts` (84 lines) | Covers: health, events CRUD, analytics track, search, flags. **Missing:** error handler (500 path), admin dashboard, POST /errors, idempotency. |
| `@rota-core/analytics` | **None** | ❌ No tests for `AnalyticsService` (funnel, active users, top pages). |
| `@rota-core/search` | **None** | ❌ No tests for `SearchService`, `scoreDocument`, or `InMemorySearchAdapter`. |
| `@rota-core/monitoring` | **None** | ❌ No tests for `AlertManager`, `LatencyTracker`, `ErrorCollector`, `HealthCheckRegistry`. |
| `@rota-core/feature-flags` | **None** | ❌ No tests for `evaluateFlag` (the most logic-dense, pure function). |
| `@rota-core/logger` | **None** | ❌ No tests for redaction, log levels, child loggers. |
| `@rota-core/config` | **None** | ❌ No tests for `loadEnv`. |
| `@rota-core/db` | **None** | N/A (only an interface + schema strings — integration tests needed). |
| `@rota-core/sdk` | **None** | ❌ No smoke test for `createRotaCore()`. |

**Overall test coverage estimate: ~25-30% of code paths.**

The events package (the most critical module) is well-tested. But `analytics`, `search`, `monitoring`, and `feature-flags` have zero unit tests — these are all pure-function-heavy packages where unit testing would be easy and highly valuable.

---

## 9. Recommended Next 5 Commits

Ordered by risk/value ratio (highest first):

---

### Commit 1 — `fix: recover stuck 'processing' events on startup`

**File:** `packages/events/src/consumer.ts` + `postgres-store.ts`

Add a `recoverStuck(timeoutMs: number)` method to `EventStore` that resets `processing` events older than `timeoutMs` back to `pending`. Call it in `server.ts` at startup before beginning the poll loop.

```typescript
// EventStore interface addition
recoverStuck(olderThan: Date): Promise<number>;

// PostgresEventStore
async recoverStuck(olderThan: Date): Promise<number> {
  const result = await this.sql.query(
    `UPDATE rota_events SET status = 'pending'
     WHERE status = 'processing' AND created_at < $1`,
    [olderThan]
  );
  return result.rowCount ?? 0;
}
```

**Why first:** A server crash right now permanently loses in-flight events. This is a data-loss bug.

---

### Commit 2 — `feat(api): add authentication middleware + admin route protection`

**File:** `apps/api/src/app.ts`

Add a Fastify `preHandler` hook on `/admin/*` routes that checks a shared secret bearer token from the environment (`ADMIN_TOKEN`). Block unauthenticated requests with `401`.

```typescript
// In buildApp, add:
app.addHook('preHandler', async (request, reply) => {
  if (!request.url.startsWith('/admin')) return;
  const token = request.headers['authorization']?.replace('Bearer ', '');
  if (token !== env.ADMIN_TOKEN) {
    return reply.status(401).send(fail('UNAUTHORIZED', 'Missing or invalid admin token'));
  }
});
```

**Why second:** The admin endpoints expose the full error log, all events, and the service dashboard with zero access control.

---

### Commit 3 — `test: add unit tests for analytics, search, feature-flags, monitoring`

**New files:**
- `packages/analytics/__tests__/analytics.test.ts`
- `packages/search/__tests__/search.test.ts`
- `packages/feature-flags/__tests__/feature-flags.test.ts`
- `packages/monitoring/__tests__/monitoring.test.ts`

Focus on pure functions first: `evaluateFlag` (all targeting rule combinations), `scoreDocument`, `countByFingerprint`, `LatencyTracker.stats()`. These have zero external dependencies and can be tested exhaustively.

**Why third:** These four packages have the most logic and zero tests. A bug in `evaluateFlag` silently gives access to wrong users. A bug in `scoreDocument` returns wrong search results. Both are silent and hard to detect.

---

### Commit 4 — `fix(events): add 'processing' status to EventStatus type + add event type constants`

**File:** `packages/types/src/index.ts` + new `packages/events/src/event-types.ts`

```typescript
// event-types.ts
export const EventTypes = {
  USER_REGISTERED: 'user.registered',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  POST_COMMENT_CREATED: 'post.comment.created',
} as const;
export type KnownEventType = (typeof EventTypes)[keyof typeof EventTypes];
```

Replace all bare string literals in `event-integration.ts` with `EventTypes.*` constants. This prevents typos and gives a single source of truth for known event types across the ecosystem.

**Why fourth:** String literal event types silently break if renamed. A const registry + TypeScript union type makes mismatches a compile error.

---

### Commit 5 — `feat(api): add graceful shutdown + CORS + rate limiting`

**File:** `apps/api/src/server.ts` + `apps/api/package.json`

```typescript
// server.ts additions
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

await app.register(cors, { origin: env.CORS_ORIGIN ?? false });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down`);
  clearInterval(pollInterval);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

**Why fifth:** Required for container deployment (Kubernetes sends `SIGTERM` before killing). CORS is needed for `/track.js` to work from browsers. Rate limiting prevents the public analytics endpoint from being used as a DoS vector.

---

## Summary Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Monorepo structure | ✅ 9/10 | Clean, logical, well-layered |
| Package boundaries | 🟡 7/10 | `db` dep in `events` is leaky; barrel exports need attention |
| Module coupling | 🟡 7/10 | Good interface discipline; string event types are fragile |
| Event-driven architecture | 🟡 7/10 | Strong foundations; stuck `processing` and sync delivery are gaps |
| Over-engineering | ✅ 8/10 | Disciplined; workflow engine is the only premature feature |
| Production readiness | 🔴 4/10 | Auth, SMTP, migrations, CORS, graceful shutdown all missing |
| Maintainability | ✅ 8/10 | Very readable, consistent, well-documented |
| Test coverage | 🟡 5/10 | Events/API covered; analytics/search/flags/monitoring zero coverage |

**Overall: Architecturally sound early-stage platform. The foundations are better than most projects at this stage. The primary blockers before any production deployment are authentication, the processing-leak bug, real email delivery, and broader test coverage.**
