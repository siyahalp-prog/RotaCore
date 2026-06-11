# Rota Monitoring

Observability for Rota services: health, errors, logs, latency, alerts.

## Components

```ts
import {
  HealthCheckRegistry,
  ErrorCollector,
  LogIngestion,
  LatencyTracker,
  AlertManager,
  ConsoleAlertChannel,
  WebhookAlertChannel,
  buildServiceDashboard,
} from '@rota-core/monitoring';
```

- **HealthCheckRegistry** — `register('database', fn)`, `run()` →
  `healthy | degraded | unhealthy` with per-check latency. Served at `GET /health`.
- **ErrorCollector** — `captureException(service, error, context)`; groups by
  fingerprint (`service + first message line`); notifies listeners.
- **LogIngestion** — central log intake (`service`, `level`, `message`, `context`)
  with query filters.
- **LatencyTracker** — `record(endpoint, ms)`; `slowEndpoints(thresholdMs)`
  flags endpoints whose p95 exceeds the threshold. The API records every
  response automatically.
- **AlertManager** — rules (`errorThreshold` within `windowMs`, optional
  service filter) evaluated against collected errors; alerts fan out to
  channels (`ConsoleAlertChannel`, `WebhookAlertChannel` — Discord-compatible).
  A cooldown prevents alert storms.
- **buildServiceDashboard** — aggregate view (health + top errors + slow
  endpoints + recent alerts) served at `GET /admin/dashboard`.

## Example

```ts
const errors = new ErrorCollector();
const alerts = new AlertManager(errors)
  .addRule({ name: 'api-errors', severity: 'critical', errorThreshold: 10, windowMs: 60_000 })
  .addChannel(new WebhookAlertChannel(env.DISCORD_WEBHOOK_URL));

setInterval(() => void alerts.evaluate(), 30_000);
```

## Next steps

- Persist errors/logs to PostgreSQL (`monitoring_errors`, `monitoring_logs`
  schemas already exist in `packages/db`).
- Uptime checks against external URLs.
- Grafana/Prometheus integration (later phase).
