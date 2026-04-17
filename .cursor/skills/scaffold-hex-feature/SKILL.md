---
name: scaffold-hex-feature
description: Scaffolds a new backend feature in the SmoothFS Elysia backend following hexagonal architecture — creates domain types, a port interface, a Drizzle adapter, a use-case service, and an Elysia controller with validated input/output and REST conventions. Use when adding a new backend capability (endpoint, resource, or use-case), when the user asks to "add an endpoint", "add a service", "add a feature to the API", or when extending `apps/backend/src/`.
---

# Scaffold a Hex-Arch Feature

Use this workflow whenever a new backend capability is added. It enforces the layering required by `project-core` and `backend-hexarch` rules.

## Inputs to collect

Before writing code, confirm:

1. **Feature name** in camelCase (e.g. `moveFolder`, `searchFolders`).
2. **HTTP shape** — method, path, inputs (params/query/body), response.
3. **Persistence** — which table(s), read-only or mutating, any new index needed.
4. **Errors** — what domain errors can this raise (not-found, conflict, invalid).

If any are ambiguous, ask before generating files.

## Files to create

Create these in order; each depends on the previous. Use the exact feature name throughout.

### 1. Domain types / errors (if new)

`apps/backend/src/domain/<aggregate>/<FeatureName>.ts`

- Pure TS types and branded ids. No framework imports.
- Domain errors extend a shared `DomainError` base (create it if missing).

### 2. Port (interface)

`apps/backend/src/ports/<AggregateRepository>.ts`

Add a method to the existing repository port, or a new port if this is a new aggregate. Keep it minimal and returns typed results — no Drizzle types leak here.

### 3. Adapter (Drizzle)

`apps/backend/src/adapters/db/<aggregateRepositoryDrizzle>.ts`

- Implement only the port. Use prepared statements. For anything tree-shaped, follow the Recursive CTE pattern from `tree-data-model`.
- Cap recursion depth, use keyset cursors for pagination.

### 4. Use-case

`apps/backend/src/application/<featureName>.ts`

```ts
export class <FeatureName> {
  constructor(private readonly repo: <AggregateRepository>) {}
  async exec(input: <FeatureName>Input): Promise<<FeatureName>Output> {
    // validate invariants, orchestrate repo calls, throw typed domain errors
  }
}
```

One use-case per file. No HTTP, no SQL, no logging beyond `logger.debug`.

### 5. HTTP schema + controller

`apps/backend/src/adapters/http/<featureName>.route.ts`

- Define Elysia `t.Object` schemas for params/query/body and the response.
- Register under `/api/v1/...`. Use correct verb + status code.
- Controller body is 3 lines: parse input → call `useCase.exec()` → map to response.

### 6. Wire into DI

`apps/backend/src/infrastructure/container.ts` (create if missing) — construct the adapter once, inject it into the use-case, pass the use-case to the route.

### 7. Tests

- `application/<featureName>.test.ts` — use an in-memory fake implementing the port; cover happy path + each domain error.
- `adapters/db/<...>.test.ts` — integration test against a real Postgres if the query is non-trivial (especially recursive).
- Add an E2E step to the Playwright flow only if it's user-visible.

## Checklist before handing off

- [ ] Domain has no framework imports
- [ ] Service receives its repository via constructor
- [ ] Route validates every input with Elysia schema
- [ ] Correct HTTP status codes, under `/api/v1`
- [ ] Structured log on entry with `requestId` + feature name
- [ ] Typed domain errors mapped to HTTP in the central error handler
- [ ] At least one unit test for the use-case; integration test for any new SQL
- [ ] Required indexes added in a migration if new query shape
