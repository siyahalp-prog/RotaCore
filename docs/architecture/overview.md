# Rota Core — Architecture Overview

## Purpose

Rota Core is the shared platform infrastructure layer for the Rota ecosystem
(RotaGlobal, Rota Identity, Falcion, RotaGames, RotaAI and future products).
Instead of every product rebuilding events, notifications, analytics, search,
monitoring, feature flags and workflows, they consume these capabilities from
Rota Core.

## High-level diagram

```txt
            ┌─────────────────────────────────────────────────┐
            │                 Rota Products                   │
            │  RotaGlobal · Rota Identity · Falcion · Games   │
            └───────────────┬─────────────────────────────────┘
                            │  @rota-core/sdk (facade)
            ┌───────────────▼─────────────────────────────────┐
            │                  Rota Core                      │
            │                                                 │
            │  events ──► notifications                       │
            │     │   ──► workflows ──► (actions)             │
            │     │   ──► analytics                           │
            │  search      monitoring      feature-flags      │
            │                                                 │
            │  foundation: core · types · config · logger · db│
            └───────────────┬─────────────────────────────────┘
                            │  storage adapters
            ┌───────────────▼─────────────────────────────────┐
            │  In-memory (dev/test) │ PostgreSQL (production) │
            │  future: Redis Streams · RabbitMQ · Meilisearch │
            └─────────────────────────────────────────────────┘
```

## Key principles

1. **Adapter boundaries.** Every module defines a storage/transport interface
   (`EventStore`, `SearchAdapter`, `EmailProvider`, `AlertChannel`, ...).
   In-memory implementations power tests and local development; PostgreSQL
   implementations power production. Redis/RabbitMQ/Kafka/Meilisearch can be
   added later without touching business logic.
2. **Events are the backbone.** Products publish events
   (`user.registered`, `post.created`, ...). Notifications, workflows and
   analytics react to them. This keeps modules decoupled.
3. **Strict TypeScript everywhere.** `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`. Zod validates all external input (event
   payloads, env vars, tracking calls, workflow definitions).
4. **Practical for one developer.** Packages are consumed as TypeScript source
   inside the monorepo (no per-package build step yet). Apps run via `tsx`.
   Deployment packaging is deliberately deferred (see ADR 0001).
5. **No fake security, no real secrets.** Configuration is validated via
   `@rota-core/config`; the logger redacts secret-looking keys; `.env` is
   git-ignored and only `.env.example` is committed.

## Package dependency graph

```txt
types ◄── core ◄── config
  ▲         ▲
  │         │
  db ◄── events ◄── notifications
  │         ▲    ◄── workflows
  │         │
  └── search┘    analytics   monitoring   feature-flags
              ▲      ▲           ▲             ▲
              └──────┴────── sdk ┴─────────────┘
                              ▲
                    apps/api · apps/admin
```

## Runtime model

- `apps/api` is a Fastify HTTP API exposing tracking, search, events, flags,
  health and admin endpoints.
- Event consumption is pull-based: a worker loop calls
  `consumer.processPending()`. Failed events retry with exponential backoff and
  eventually land in the dead letter queue; admins can replay them.
- The same process can host all modules today; the package boundaries allow
  extracting independent services later without code rewrites.
