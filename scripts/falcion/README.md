# Falcion Data Engine — integration points

Per the roadmap (Faz 9), the Falcion Data Engine is product-specific and will
live in `apps/falcion-engine` or a separate repo — **not** in Rota Core's
shared packages.

This folder is reserved for Falcion data ingestion scripts. Planned Rota Core
integration points:

- **Company database schema** — via `packages/db` (to be added with the engine)
- **Data ingestion scripts** — `scripts/falcion/*`
- **Rota Search** — index company documents (`type: 'company'`), already supported
- **Rota Analytics** — track company page views, already supported
- RAG search, source citations, analysis reports, comparison pages — inside
  the Falcion engine app itself
