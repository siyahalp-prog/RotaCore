# ADR 0001 — TypeScript monorepo with pnpm workspaces

- **Status:** Accepted
- **Date:** 2026-06-11

## Context

Rota Core hosts many small, related platform modules (events, notifications,
analytics, search, monitoring, feature flags, workflows, SDK) that share types,
error formats and tooling. They are developed by a small team (currently one
developer) and consumed by multiple Rota products.

## Decision

1. **Single monorepo** (`rota-core`) using **pnpm workspaces** with `apps/*`
   and `packages/*`.
2. **Strict TypeScript** with a shared `tsconfig.base.json`
   (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `verbatimModuleSyntax`).
3. **Packages are consumed as TypeScript source** (`main: ./src/index.ts`).
   No per-package build/dist step yet: tests run through Vitest, apps run
   through `tsx`, and `pnpm build`/`pnpm typecheck` performs a full strict
   compile check. When packages need publishing or apps need bundled deploys,
   a build pipeline (tsup/tsc project references) will be added in a separate
   ADR.
4. **Shared tooling at the root:** one ESLint flat config, one Prettier config,
   one Vitest run covering all `__tests__` folders.
5. **Adapter-first storage:** modules depend on interfaces; PostgreSQL schemas
   live centrally in `packages/db`. No hard dependency on a database driver.

## Consequences

- New modules are cheap to add and immediately share types/tooling.
- Cross-package refactors are atomic (single PR).
- Independent deployment is still possible later: each package has clean
  boundaries and its own manifest.
- Deferring the build step keeps iteration fast but means consumers outside
  this repo cannot install the packages yet — acceptable while Rota Core is
  pre-publication.
