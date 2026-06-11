# Deployment

Deliberately minimal for now (see ADR 0001 — deployment is not over-engineered
in the early phase).

## Local / single-server

```bash
pnpm install
pnpm --filter @rota-core/api start   # runs via tsx
```

Configuration via environment variables (validated by `@rota-core/config`);
see `.env.example`. Apply database schemas with `applySchema(client)` from
`@rota-core/db` or by running the SQL in `packages/db/src/schema.ts` via psql.

## Production checklist (before first real deploy)

- [ ] Provision PostgreSQL and apply schemas
- [ ] Swap in-memory adapters for PostgreSQL adapters in the API wiring
- [ ] Configure SMTP provider (replace placeholder)
- [ ] Set `DISCORD_WEBHOOK_URL` for alerts
- [ ] Add a process manager / container image and CI pipeline
- [ ] Run the security & production readiness review (roadmap §20)
