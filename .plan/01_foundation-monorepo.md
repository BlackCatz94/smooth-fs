# Phase 01 — Foundation and Monorepo Setup

## Objective

Set up the baseline workspace so all future features can be built consistently across backend, frontend, and shared types.

## Project-core alignment

- **Smooth:** enforce architecture choices early to avoid costly refactors that cause performance regressions later.
- **Reliable:** strict TypeScript boundaries and shared contracts from day one.
- **Debuggable:** standardized scripts, env validation, and logging conventions are created before feature work.

## Tasks

- Create Bun workspace structure:
  - `apps/frontend`
  - `apps/backend`
  - `packages/shared`
- Add root TypeScript config with strict mode and shared path aliases.
- Add package-level `tsconfig` files that extend from root.
- Add root scripts for `dev`, `build`, `test`, `lint`, and `typecheck`.
- Create shared contracts in `packages/shared`:
  - folder/file DTOs
  - API response envelope types
  - pagination cursor types
- Define env strategy:
  - `.env.example` for each app
  - runtime env validation module for backend
  - `VITE_*` convention for frontend
- Add base lint/format config and CI-ready command set (no implementation CI yet).

## Done criteria

- `bun install` and workspace linking work from root.
- Both apps compile with shared type imports.
- Root scripts run without path hacks.
- Shared types are imported (not redefined) in both apps.

## Vague edge cases (needs choice)

- **Monorepo tooling scope:** Bun workspace only vs Bun workspace + Turborepo task orchestration.
- **Path alias policy:** only shared-package aliases vs deep aliases per app (trade-off: clarity vs convenience).
- **Single source of env schema:** one centralized schema package vs per-app schemas (trade-off: consistency vs app autonomy).

User's Choice:
- Use Bun workspace + Turborepo (Bun workspaces handle dependency linking, Turborepo handles task orchestration (caching, parallel execution))

- Deep aliases per app (@/services, @/domain, etc.) + shared package via npm scope (@smoothfs/shared)
Example:
FE: @/components, @/composables, @/stores
BE: @/domain, @/ports, @/adapters, @/services
Cross: @smoothfs/shared

- Definitely per-app schemas for SOLID principles

Follow-up Decision:
- Zod for validation