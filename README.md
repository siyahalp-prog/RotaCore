<div align="center">
  <img src="docs/assets/hero.png" alt="Rota Core Hero Banner" width="100%" />

  # Rota Core 🌌
  **The ultimate event-driven backend framework for modular, production-ready SaaS architectures.**

  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Fastify](https://img.shields.io/badge/fastify-202020?style=for-the-badge&logo=fastify&logoColor=white)](https://www.fastify.io/)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
  [![Vitest](https://img.shields.io/badge/-Vitest-729B1B?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
  [![Coverage](https://img.shields.io/badge/Coverage-90%25-brightgreen?style=for-the-badge)](#)
</div>

---

## 📖 Overview

**Rota Core** is a high-performance, strictly-typed monorepo framework designed to build secure, scalable, and highly observable backend services. Built around an **Event-Driven Architecture (EDA)**, it ensures that your modules (Analytics, Workflows, Notifications) remain completely decoupled.

Say goodbye to tangled monoliths and spaghetti code. Rota Core provides everything you need to ship enterprise-grade applications, right out of the box.

---

## 🚀 Key Features

*   **⚡ Event-Driven Engine**: Publish-subscribe architecture with guaranteed at-least-once delivery, dead-letter queues (DLQ), and stuck-event recovery.
*   **🛠️ Workflow Orchestration**: Define complex JSON-based multi-step workflows with retries, specific step timeouts (`Promise.race`), payload isolation, and visual run logs.
*   **🛡️ Production-Grade Security**: Built-in HTTP 429 Rate Limiting, CORS preflight, `Bearer` token admin authentication, and strict Zod payload validations.
*   **🕵️ Privacy-First Analytics**: Automatically strips PII from URLs and user agents before storage. Tracks DAU/WAU/MAU and computes funnel conversions efficiently.
*   **📦 Idempotent Migrations**: A robust `MigrationRunner` ensuring your PostgreSQL schema is version-controlled and safely applied on startup.
*   **📧 Notifications & SMTP**: Fully integrated Nodemailer provider with safe-fallback Console and InMemory providers for local dev & testing.
*   **🔎 Full-Text Search**: Built-in adapter for PostgreSQL `TSVECTOR` capabilities for blazing fast content indexing.
*   **🚦 Feature Flags**: Role-based feature rollouts evaluated at edge speed.

---

## 🏗️ Architecture

Rota Core utilizes an advanced internal decoupled structure. Instead of calling modules directly, services emit **Events**. Consumers subscribe to these events to execute background workflows, track analytics, and send notifications.

```mermaid
graph TD
    API[Fastify API HTTP Layer] -->|POST /events| CoreSDK((Rota Core SDK))
    
    subgraph Packages
        CoreSDK --> EventsEngine{Events Engine}
        EventsEngine -->|Trigger| WorkflowEngine[Workflow Engine]
        EventsEngine -->|Hook| Notifications[Notifications Service]
        EventsEngine -->|Record| Analytics[Analytics Service]
    end

    WorkflowEngine --> DB[(PostgreSQL)]
    EventsEngine --> DB
    Analytics --> DB
    
    Notifications --> SMTP[SMTP / Nodemailer]
    
    style API fill:#1E1E1E,stroke:#3b82f6,stroke-width:2px,color:#fff
    style CoreSDK fill:#7e22ce,stroke:#a855f7,stroke-width:2px,color:#fff
    style EventsEngine fill:#2563eb,stroke:#60a5fa,stroke-width:2px,color:#fff
    style WorkflowEngine fill:#059669,stroke:#34d399,stroke-width:2px,color:#fff
    style DB fill:#334155,stroke:#94a3b8,stroke-width:2px,color:#fff
```

---

## 🎨 Admin Dashboard (Preview)

Rota Core comes with a fully observable architecture that powers Admin metrics.

<div align="center">
  <img src="docs/assets/dashboard.png" alt="Rota Core Admin Dashboard" width="800" style="border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);" />
  <br>
  <em>Conceptual mockup of the Admin observability layer powered by Rota Core endpoints.</em>
</div>

---

## 📦 Packages

Rota Core is a pnpm workspace monorepo.

| Package | Description |
|---|---|
| `@rota-core/core` | Base interfaces, custom Error classes (e.g., `RateLimitError`), Clock, and ID generators. |
| `@rota-core/sdk` | The central Facade. Wires up all services. You only need to import this! |
| `@rota-core/db` | PostgreSQL `SqlClient`, `MigrationRunner`, and schemas. |
| `@rota-core/events` | Pub/Sub engine. `PostgresEventStore` uses `SKIP LOCKED` for atomic parallel processing. |
| `@rota-core/workflows` | Orchestrator for multi-step processes. Includes Promise-based timeouts and payload isolation. |
| `@rota-core/analytics` | Privacy-centric tracking. Computes DAU, funnels, and strips PII from referrers/URLs. |
| `@rota-core/notifications`| Notification engine. Includes fully configured SMTP via `nodemailer`. |
| `@rota-core/search` | Full-text indexing adapter. |
| `@rota-core/monitoring`| Latency tracking, Health checks, and centralized Error logging. |
| `@rota-core/feature-flags`| Role-based and percentage-based feature flag evaluations. |

---

## 💻 Getting Started

### 1. Prerequisites
- Node.js >= 20.0.0
- `pnpm` >= 9.0.0
- PostgreSQL >= 14

### 2. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/siyahalp-prog/RotaCore.git
cd RotaCore
pnpm install
```

### 3. Environment Variables

Create a `.env` file in the `apps/api` directory using the provided example:

```bash
cp .env.example .env
```

**Key variables to set:**
```env
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/rotacore

# Security
# Generate a secure token: openssl rand -hex 32
ADMIN_TOKEN=super-secret-token-123
CORS_ORIGIN=https://your-frontend-domain.com

# SMTP Delivery (Optional for local dev)
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=your-api-key
SMTP_FROM=noreply@yourdomain.com
```

### 4. Run the API

The `dev` script uses `tsx` with watch mode for rapid development:

```bash
# From the root directory
pnpm run dev --filter @rota-core/api
```

The server will automatically:
1. Run pending DB migrations safely.
2. Recover any stuck events from previous crashes.
3. Start the API on `http://0.0.0.0:3000`.

---

## 🔥 Workflows Example

Rota Core excels at multi-step asynchronous processes. Workflows ensure your business logic is resilient to failure.

**1. Register Actions and Definitions:**

```typescript
import { createRotaCore } from '@rota-core/sdk';

const core = createRotaCore({ serviceName: 'my-app' });

// Register a discrete action
core.workflows.registerAction('send.welcome.email', async (ctx, input) => {
  // context.event.payload contains the dynamic runtime data
  const email = ctx.event.payload.email as string;
  // input contains static workflow configuration
  const templateId = input.template as string;
  
  await core.notifications.send({ to: email, template: templateId });
});

// Register the Workflow Definition
core.workflows.registerWorkflow({
  id: 'onboarding-workflow',
  name: 'New User Onboarding',
  trigger: { event: 'user.registered' },
  steps: [
    { 
      id: 'step-1', 
      action: 'send.welcome.email', 
      input: { template: 'welcome-v2' },
      retries: 3,             // Automatically retry 3 times on failure
      stepTimeoutMs: 15000    // Abort action if it takes longer than 15s
    }
  ]
});
```

**2. Trigger the Event:**

When an event is published via the API, the Background Worker safely executes the workflow.

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "user.registered",
    "source": "api",
    "payload": { "email": "alice@example.com" }
  }'
```

---

## 🛡️ Security & Privacy Hardening

We take production safety seriously. Recent security audits implemented the following guarantees:
*   **Payload Injection Prevention:** Workflow `step.input` is strictly isolated from `event.payload`.
*   **Automated PII Stripping:** The Analytics engine automatically removes query parameters (e.g., `?token=xyz`) from tracked `pageUrl` and `referrer` properties.
*   **Log Redaction:** All Fastify requests log via `@rota-core/logger` which utilizes a robust `DEFAULT_REDACT_KEYS` array to automatically mask `Authorization`, `cookie`, `email`, and `ssn` strings.
*   **Graceful Shutdown:** The API correctly hooks into `SIGTERM` and `SIGINT` to drain connections and cleanly stop the event polling loop before exiting.

---

## 🧪 Testing

We use [Vitest](https://vitest.dev/) across the monorepo. Tests are designed to run blazingly fast in-memory, utilizing mock databases and `InMemoryWorkflowStore`.

```bash
# Run all tests
pnpm test

# Run typechecker
pnpm typecheck

# Run linter
pnpm lint
```

Currently, the test suite boasts **90 passing tests** focusing heavily on orchestration logic, privacy boundaries, and database idempotency.

---

## 📜 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

<div align="center">
  <br>
  <i>Built with ❤️ for resilient SaaS products.</i>
</div>
