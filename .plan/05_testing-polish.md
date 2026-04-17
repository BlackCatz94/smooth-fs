# Phase 05 — Testing, Observability, and Polish

## Objective

Lock in correctness, performance confidence, and operational debuggability before release-level iteration.

## Project-core alignment

- **Smooth:** performance-critical paths are measured and protected with regression coverage.
- **Reliable:** multi-layer tests validate contracts and edge behavior.
- **Debuggable:** logs, request IDs, and failure messages are consistent from API to UI.

## Tasks

- Backend unit tests (`bun test`) for application services using fake repositories.
- Backend integration tests for DB adapters and recursive query behaviors.
- Frontend unit tests (Vitest + Vue Test Utils):
  - recursive tree rendering
  - expand/collapse behavior
  - lazy-loading flow
  - accessibility attributes
- Add E2E flow with Playwright:
  - load app
  - expand folder
  - inspect right panel contents
  - run search
- Add test fixtures for deep hierarchy and wide sibling counts.
- Add observability checks:
  - request ID continuity
  - error response shape consistency
  - slow-operation logging thresholds
- Final cleanup:
  - remove debug-only artifacts not needed in production
  - verify no forbidden tree libraries
  - run full test suite + typecheck + lint gate

## Done criteria

- Test pyramid exists and passes (unit/integration/E2E).
- At least one regression test added for each bug fixed during implementation.
- Performance-sensitive interactions have baseline timing evidence.
- Logging and error paths are readable for developers and operators.

## Vague edge cases (needs choice)

- **Integration test infra:** real Postgres container in CI vs lightweight in-memory substitutes for speed.
- **E2E environment:** mock API mode for determinism vs real backend for fidelity.
- **Performance gate policy:** hard CI thresholds vs report-only trend tracking in early iterations.
- **Coverage target strictness:** fixed percentage gate now vs phase-in by module criticality.
