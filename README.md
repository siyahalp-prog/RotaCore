# Rota Core

Shared platform infrastructure for the Rota ecosystem.

## What is Rota Core?

Rota Core is the reusable infrastructure layer behind Rota products such as RotaGlobal, Rota Identity, Falcion, RotaGames and future Rota applications.

It provides core platform capabilities including:

- Event-driven architecture
- Notifications
- Analytics
- Search
- Monitoring
- Feature flags
- Workflow automation
- Shared SDKs
- Admin infrastructure

## Why?

Instead of rebuilding the same infrastructure for every product, Rota Core centralizes reusable platform services and provides a consistent foundation for the entire Rota ecosystem.

## Modules

```txt
Rota Core
├── Events          packages/events          — publish/consume, retry, DLQ, replay, idempotency
├── Notifications   packages/notifications   — in-app + email, templates, preferences
├── Analytics       packages/analytics       — page views, events, funnels, DAU/WAU/MAU
├── Search          packages/search          — indexing, ranking, filters, search logs
├── Monitoring      packages/monitoring      — health checks, errors, latency, alerts
├── Feature Flags   packages/feature-flags   — user/role/percentage rollouts
├── Workflows       packages/workflows       — JSON-defined event-driven automations
├── Admin Hub       apps/admin               — admin UI (placeholder; API ready)
└── SDK             packages/sdk             — one-call facade for all modules
```

Foundation packages: `core` (errors, API envelope, ids, time), `types`, `config` (Zod env validation), `logger` (structured + secret redaction), `db` (SQL client abstraction + PostgreSQL schemas).

## Getting started

```bash
pnpm install
pnpm test        # run all package tests
pnpm typecheck   # strict TypeScript check
pnpm lint        # ESLint
pnpm dev         # start the Rota Core API (apps/api) on :3000
```

Copy `.env.example` to `.env` for local configuration. No real secrets are committed.

## Quick example

```ts
import { createRotaCore } from '@rota-core/sdk';

const rota = createRotaCore({ serviceName: 'rotaglobal' });

await rota.events.publisher.publish({
  type: 'user.registered',
  source: 'rota-identity',
  actorId: 'user-1',
  payload: { name: 'Ada' },
});
await rota.events.consumer.processPending(); // → welcome notification, workflows, ...
```

By default everything runs on in-memory adapters (great for development and tests).
For production, pass PostgreSQL adapters (`PostgresEventStore`, `PostgresSearchAdapter`, ...)
backed by the schemas in `packages/db`.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [ADR 0001 — Monorepo](docs/adr/0001-monorepo.md)
- Module docs: [events](docs/modules/events.md) · [notifications](docs/modules/notifications.md) · [analytics](docs/modules/analytics.md) · [search](docs/modules/search.md) · [monitoring](docs/modules/monitoring.md) · [feature flags](docs/modules/feature-flags.md) · [workflows](docs/modules/workflows.md)
- [Integration examples](docs/integrations)

## Status

Early development.

## Related Projects

- RotaGlobal
- Rota Identity
- Falcion
- RotaGames

## License

TBD
