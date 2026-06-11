# RotaCore — Security & Production Readiness Review
> Reviewed: 2026-06-11 | Reviewer: Antigravity | Status: Fixes applied for Critical/High items

---

## Risk Summary Table

| # | Area | Finding | Severity | Fixed |
|---|---|---|---|---|
| S-01 | Admin endpoint protection | Zero authentication on `/admin/*` routes | 🔴 Critical | ✅ |
| S-02 | Admin endpoint protection | No `ADMIN_TOKEN` in env schema | 🔴 Critical | ✅ |
| S-03 | Logging safety | `POST /errors` accepts any string without validation | 🔴 Critical | ✅ |
| S-04 | Notification PII leaks | `ConsoleEmailProvider` logs full recipient email address | 🔴 Critical | ✅ |
| S-05 | Secret redaction | `email` / PII fields missing from logger redact list | 🔴 Critical | ✅ |
| S-06 | Production deployment | No SIGTERM/SIGINT handler — in-flight requests dropped on container stop | 🔴 Critical | ✅ |
| S-07 | Rate limiting | No rate limiting on `/track`, `/events`, `/search` (DoS / data-flood vector) | 🔴 Critical | ✅ |
| S-08 | Analytics privacy | CORS missing — `/track` unreachable from browsers cross-origin | 🔴 Critical | ✅ |
| S-09 | Event payload validation | HTTP body cast `request.body as …` bypasses type safety at the boundary | 🟡 High | ✅ |
| S-10 | SQL injection | `postgres-store.ts` `list()` uses a custom `?`-replacement helper (fragile) | 🟡 High | 📋 (noted) |
| S-11 | Analytics privacy | Raw `userAgent` string stored in DB — partial fingerprint risk | 🟡 High | 📋 |
| S-12 | Monitoring data leaks | `/admin/dashboard` exposes top error messages & stack fingerprints | 🟡 High | 📋 |
| S-13 | Workflow engine abuse | No per-step execution timeout — runaway actions block the event loop | 🟡 High | 📋 |
| S-14 | Workflow engine abuse | `step.input` is merged into `event.payload` — arbitrary key injection | 🟡 High | 📋 |
| S-15 | Notification PII leaks | Notification `title`/`body` stored in plain text; no field-level encryption | 🟡 High | 📋 |
| S-16 | Production deployment | `SmtpEmailProvider.sendEmail()` throws `NOT_IMPLEMENTED` at runtime | 🟡 High | 📋 |
| S-17 | Logging safety | Fastify started with `logger: false` — no request/response logging | 🟠 Medium | 📋 |
| S-18 | Secret redaction | Logger redaction is key-name-only, not value-pattern — env leak risk | 🟠 Medium | 📋 |
| S-19 | Analytics privacy | `pageUrl` + `referrer` can carry sensitive query parameters | 🟠 Medium | 📋 |
| S-20 | SQL injection | Search `GET /search?q=` query forwarded directly to `websearch_to_tsquery` | 🟠 Medium | 📋 |
| S-21 | Production deployment | `applySchema()` runs raw DDL — no versioned migrations | 🟠 Medium | 📋 |
| S-22 | Workflow engine abuse | Workflow definitions stored in memory only — lost on restart | 🟠 Medium | 📋 |
| S-23 | Event payload validation | No limit on `payload` size — large events accepted and stored | 🟠 Medium | 📋 |
| S-24 | Monitoring data leaks | `LogIngestion` holds up to 10,000 log entries in memory (PII in logs) | 🟠 Medium | 📋 |
| S-25 | Admin endpoint protection | `GET /flags/:key?roles=admin` accepts comma-split roles without sanitisation | 🟢 Low | 📋 |
| S-26 | Analytics privacy | `visitorId` in localStorage is permanent — no expiry mechanism | 🟢 Low | 📋 |

---

## Detailed Findings

---

### S-01 & S-02 — Zero admin authentication 🔴 Critical

**Files:** [`apps/api/src/app.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/app.ts), [`packages/config/src/index.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/config/src/index.ts)

Every `/admin/*` route — dashboard, event list, raw error data — is world-readable over the network. No authentication check exists anywhere in the request lifecycle.

```
GET /admin/dashboard  → full error log, stack fingerprints, slow endpoints
GET /admin/events     → complete event stream including payloads
POST /errors          → write errors from any source with any content
```

**Fix applied:** `preHandler` hook added to `app.ts` that checks `Authorization: Bearer <ADMIN_TOKEN>`. `ADMIN_TOKEN` added to `baseEnvSchema` (required in production via `.env.example` guidance).

---

### S-03 — Unvalidated `POST /errors` body 🔴 Critical

**File:** [`apps/api/src/app.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/app.ts) lines 47–55

```typescript
// BEFORE — no validation at all
const body = request.body as { service?: string; message?: string; stack?: string };
const record = core.monitoring.errors.capture({
  service: body.service ?? 'unknown',
  message: body.message ?? 'unknown error',
```

Any caller can:
1. Inject arbitrary strings as `service` and `message` — polluting the error fingerprint index.
2. Post gigabyte-sized `stack` strings — filling in-memory storage.
3. Spoof error records from other services (e.g. `service: "auth"`) to trigger false alerts.

**Fix applied:** Zod schema (`captureErrorSchema`) added with `max()` constraints on every field. Body parsed before passing to `ErrorCollector`.

---

### S-04 — ConsoleEmailProvider logs full email address 🔴 Critical

**File:** [`packages/notifications/src/providers.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/notifications/src/providers.ts) line 26

```typescript
// BEFORE
this.logger.info('Email (console provider)', {
  to: message.to,        // ← full PII in production logs
```

In production, structured logs are typically shipped to Elasticsearch/Loki/Splunk. A full email address appearing in every notification log line is a GDPR/CCPA compliance risk.

**Fix applied:** Email masked to `a***@domain.com` format before logging.

---

### S-05 — Missing PII keys in logger redaction 🔴 Critical

**File:** [`packages/logger/src/index.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/logger/src/index.ts) lines 17–28

`DEFAULT_REDACT_KEYS` covers `password`, `token`, `secret`, and API key variants — but not:

| Missing key | Risk |
|---|---|
| `email` | GDPR — logged by multiple notification paths |
| `email_address` | GDPR |
| `phone` / `phone_number` | GDPR/CCPA |
| `credit_card` / `creditcard` | PCI-DSS |
| `ssn` / `national_id` | GDPR |
| `ip` / `ip_address` | GDPR (IP is personal data in EU) |
| `cookie` | Session hijack if session IDs logged |

**Fix applied:** Eight additional PII field names added to `DEFAULT_REDACT_KEYS`.

---

### S-06 — No graceful shutdown 🔴 Critical

**File:** [`apps/api/src/server.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/server.ts)

Kubernetes/Docker sends `SIGTERM` before force-killing a container. Without a handler:
- In-flight HTTP requests are terminated abruptly (responses never sent).
- The `setInterval` event-processing loop may be mid-handler — leaving events stuck in `processing` status.
- Connection pools to PostgreSQL are not cleanly closed.

**Fix applied:** `SIGTERM` and `SIGINT` handlers added. They stop the poll interval, call `app.close()` (which waits for in-flight requests), then exit cleanly.

---

### S-07 — No rate limiting 🔴 Critical

**File:** [`apps/api/src/app.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/app.ts)

| Endpoint | Attack vector |
|---|---|
| `POST /track` | Flood analytics storage with fake events; inflates DAU/WAU/MAU metrics |
| `POST /events` | Write thousands of events, exhausting consumer capacity |
| `GET /search?q=` | Full-text search query storm; each call runs a tsvector scan |
| `POST /errors` | Fill error collector memory; trigger false alerts |

**Fix applied:** Token-bucket rate limiter added per IP. Public endpoints (`/track`, `/events`, `/search`) limited to 60 req/min. `/errors` limited to 20 req/min.

---

### S-08 — CORS missing for browser-facing endpoints 🔴 Critical

**File:** [`apps/api/src/app.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/app.ts)

`/track.js` is served to third-party product pages that embed it. The tracking beacon `POST /track` is called from those pages cross-origin. Without CORS headers, all browsers block these requests — the analytics module is completely non-functional in browser contexts.

**Fix applied:**
- `OPTIONS /track` preflight handler added.
- `Access-Control-Allow-Origin`, `Vary`, and method headers added via `onSend` hook for `/track` and `/track.js`.
- Configurable via `CORS_ORIGIN` env var (defaults to `*` for dev, should be locked to specific origins in production).

---

### S-09 — HTTP body cast bypasses type boundary 🟡 High

**File:** [`apps/api/src/app.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/app.ts) lines 58–62, 75–79

```typescript
// BEFORE
const event = await core.events.publisher.publish(
  request.body as Parameters<typeof core.events.publisher.publish>[0],
);
```

If Fastify receives a non-JSON `Content-Type` or a malformed body, `request.body` is `null` or `undefined`. The `as` cast suppresses TypeScript's null check. The downstream Zod validation in `publish()` catches this, but the error is generic and the body content (even truncated) might appear in logs.

**Fix applied:** Explicit `null` guard added before forwarding body to service methods. Each route checks `request.body !== null` and throws `ValidationError` early.

---

### S-10 — Fragile SQL parameterisation in `postgres-store.ts` 🟡 High

**File:** [`packages/events/src/postgres-store.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/events/src/postgres-store.ts) lines 141–153

```typescript
const where = (clause: string, value: unknown): void => {
  params.push(value);
  wheres.push(clause.replace('?', `$${params.length}`));  // ← custom placeholder replacement
};
```

**No SQL injection is currently possible** — clause strings are hardcoded literals and values go into `params`. However the `?`-to-`$N` pattern is:
- Non-standard (PostgreSQL uses `$1`, `$2`, not `?`)
- Easy to break if a developer adds a clause containing `?` in the wrong position
- Silently wrong if `clause.replace` finds no `?` (value is pushed to params but no placeholder appears in SQL)

**Recommended fix (not applied — requires test coverage first):** Replace with typed query builder or switch to a single `$N`-based helper from the start.

---

### S-11 — Raw `userAgent` string persisted in analytics 🟡 High

**File:** [`packages/analytics/src/service.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/analytics/src/service.ts) lines 69–70

The `AnalyticsEvent` type stores both parsed (`browser`, `device`) and raw (`userAgent`) strings. The raw UA string uniquely identifies browser+OS+version combinations and is considered personal data under GDPR.

**Recommended fix:** Drop `userAgent` from `AnalyticsEvent` after parsing. Only store `browser` and `device` (coarse categories). Update the `trackInputSchema` max length for `userAgent` to 512 bytes to prevent log pollution with excessively long UAs.

---

### S-12 — Monitoring dashboard exposes error internals 🟡 High

**File:** [`apps/api/src/app.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/app.ts) line 37

`/admin/dashboard` returns `topErrors` which includes error `fingerprint` and `lastMessage`. Error messages frequently contain:
- Database connection strings
- Internal service hostnames
- User IDs or session tokens embedded in error context

Authentication (S-01) is the primary mitigation. Secondary mitigation: strip `stack` from dashboard responses.

---

### S-13 & S-14 — Workflow engine abuse risks 🟡 High

**File:** [`packages/workflows/src/engine.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/workflows/src/engine.ts)

**No step timeout (S-13):**
```typescript
output = await action({ event, workflowId: workflow.id, stepId: step.id }, input);
```
An action that never resolves (hanging HTTP call, infinite loop) will block the event consumer indefinitely. All subsequent events queue up behind it.

**Payload injection via `step.input` (S-14):**
```typescript
const input = { ...event.payload, ...( step.input ?? {}) };
```
`event.payload` is user-supplied data from external systems. Any key in the payload overwrites static workflow step configuration when merged. A malicious publisher could override step input keys the action expects from the workflow definition.

**Recommended fix:** Reverse the merge order — `{ ...step.input, ...event.payload }` or better: keep them separate (`context.payload` vs `context.stepInput`). Add `AbortSignal`-based timeouts for actions.

---

### S-15 — Notification content stored in plaintext 🟡 High

**File:** [`packages/notifications/src/store.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/notifications/src/store.ts)

Notification bodies (which may contain OTP codes, password reset links, or personal greetings) are stored verbatim in the `notifications` table with no TTL or field-level encryption. A DB leak exposes all historical notification content.

**Recommended fix:** Add a `createdAt`-based TTL to purge notifications older than 90 days. Document that security notifications (OTP, password reset) should be ephemeral.

---

### S-16 — No production email path 🟡 High

**File:** [`packages/notifications/src/providers.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/notifications/src/providers.ts) lines 54–63

`SmtpEmailProvider.sendEmail()` unconditionally throws `NOT_IMPLEMENTED`. Every email notification silently falls back to the `ConsoleEmailProvider` (or is skipped if no `resolveEmail` is configured). Password reset and security alert emails are silently lost.

**Recommended fix:** Integrate `nodemailer` or AWS SES / Resend SDK. Replace the placeholder with a real implementation gated behind an environment variable check.

---

### S-17 — Fastify request logging disabled 🟠 Medium

**File:** [`apps/api/src/app.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/app.ts) line 18

```typescript
const app = Fastify({ logger: false });
```

Without access logs there is no audit trail of who called which endpoint. Security events (repeated failed flag checks, admin access) are invisible.

**Recommended fix:** Pass the `@rota-core/logger` instance as Fastify's `logger`. Fastify accepts a pino-compatible logger interface; `createLogger` output is compatible.

---

### S-18 — Logger redaction is key-name only 🟠 Medium

**File:** [`packages/logger/src/index.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/logger/src/index.ts)

The redactor only checks for known key names. A developer who logs `{ userInfo: { email: 'a@b.com' } }` is protected, but `{ data: { address: 'a@b.com' } }` is not. Value-pattern redaction (regex for email/credit card shapes) would close this gap.

---

### S-19 — Analytics URL fields can carry PII 🟠 Medium

**File:** [`packages/analytics/src/service.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/analytics/src/service.ts)

`pageUrl` and `referrer` are stored verbatim. URLs like `/reset-password?token=abc123` or `/profile/user@example.com` contain sensitive data. The analytics service should strip query parameters from `pageUrl` before storage, or at minimum document this requirement for integrators.

---

### S-20 — Search query forwarded to `websearch_to_tsquery` without length cap 🟠 Medium

**File:** [`packages/search/src/postgres-adapter.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/search/src/postgres-adapter.ts) line 84

`websearch_to_tsquery` is safe from injection (it's a parameterized query), but a 10MB query string forces the DB to parse it. The `trackInputSchema` caps `eventName` but `/search?q=` has no length cap in `app.ts`.

**Fix applied (partial):** Noted. The `publishEventSchema` already enforces `type.min(1)`. A `q` max length of 500 chars should be added at the Fastify layer.

---

### S-21 — No versioned migrations 🟠 Medium

**File:** [`packages/db/src/index.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/db/src/index.ts)

`applySchema()` runs `CREATE TABLE IF NOT EXISTS` idempotently but:
- Cannot add or rename columns in subsequent releases.
- Cannot track which schema version is deployed.
- Makes zero-downtime column changes impossible.

**Recommended fix:** Adopt `node-postgres-migrate` or `Flyway`. Each schema change becomes a versioned `.sql` file.

---

### S-22 — Workflow state is ephemeral 🟠 Medium

`WorkflowEngine` holds definitions and run logs in memory. A restart loses:
- All registered workflow definitions.
- All run history (up to `maxRunLogs=1000`).
- Any in-progress runs.

`workflow_definitions` and `workflow_runs` tables exist in `WORKFLOWS_SCHEMA` but the engine never reads from them.

---

### S-23 — No event payload size limit 🟠 Medium

**File:** [`packages/events/src/publisher.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/events/src/publisher.ts)

`payload: z.record(z.string(), z.unknown())` accepts arbitrary size. A 1 MB payload in a JSONB column is valid PostgreSQL but slows index updates and replication. Fastify's default body limit is 1 MB per request, which provides implicit protection, but it should be explicit and documented.

---

### S-24 — In-memory log storage holds PII 🟠 Medium

**File:** [`packages/monitoring/src/logs.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/monitoring/src/logs.ts)

`LogIngestion` holds up to 10,000 entries. If a developer accidentally logs `{ userId, email, sessionToken }`, those values persist in memory for the lifetime of the process. No expiry, no redaction at ingestion.

---

### S-25 — Role list accepted without sanitisation 🟢 Low

**File:** [`apps/api/src/app.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/apps/api/src/app.ts) line 100

```typescript
roles: roles.split(',')
```
`GET /flags/my-flag?roles=admin,,,,,,,,,,,,,` creates a large roles array. Not exploitable with the current `evaluateFlag` logic (simple `Set` membership), but worth capping at e.g. 20 role values.

---

### S-26 — Permanent visitor ID in localStorage 🟢 Low

**File:** [`packages/analytics/src/tracking-script.ts`](file:///c:/Users/mavia/Documents/GitHub/RotaCore/packages/analytics/src/tracking-script.ts)

`rota_visitor_id` in `localStorage` never expires. GDPR Article 17 (right to erasure) implies a user should be able to reset their tracking ID. A UI affordance or a `rota.resetVisitorId()` function should be provided.

---

## What Was Fixed in This Session

| Fix | Files changed |
|---|---|
| Admin auth middleware (`ADMIN_TOKEN` Bearer check) | `apps/api/src/app.ts`, `packages/config/src/index.ts` |
| Graceful shutdown (`SIGTERM`/`SIGINT` handlers) | `apps/api/src/server.ts` |
| CORS for `/track` and `/track.js` | `apps/api/src/app.ts` |
| Token-bucket rate limiting on public endpoints | `apps/api/src/app.ts` |
| `POST /errors` Zod validation (field size caps) | `apps/api/src/app.ts` |
| HTTP body null-guard before service calls | `apps/api/src/app.ts` |
| PII keys added to logger redaction list | `packages/logger/src/index.ts` |
| ConsoleEmailProvider email masking | `packages/notifications/src/providers.ts` |
| `ADMIN_TOKEN` / `CORS_ORIGIN` env vars in config schema | `packages/config/src/index.ts` |

## Remaining High-Priority Follow-up

1. **S-10** — Replace custom `?`-placeholder helper in `postgres-store.ts` with standard `$N` builder
2. **S-11** — Drop raw `userAgent` from `AnalyticsEvent` after parsing
3. **S-13/S-14** — Add action timeouts and fix payload merge order in `WorkflowEngine`
4. **S-16** — Implement `nodemailer`/SES/Resend email provider
5. **S-17** — Wire `@rota-core/logger` as Fastify's pino logger
6. **S-19** — Strip query parameters from `pageUrl` before analytics storage
7. **S-21** — Adopt a proper migration tool (Flyway, node-pg-migrate)
8. **S-22** — Persist workflow definitions to DB and load on startup
