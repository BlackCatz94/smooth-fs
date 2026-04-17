# Phase 03 — Backend API and Scalability Features

## Objective

Deliver REST endpoints and scalable data access patterns for tree browsing, children loading, and search.

## Project-core alignment

- **Smooth:** cursor-based loading, bounded responses, and optional caching protect latency under large datasets.
- **Reliable:** schema-validated inputs, semantic status codes, and clear error contracts.
- **Debuggable:** endpoint-level timings, request IDs, and query-level diagnostics for hot paths.

## Tasks

- Implement REST routes under `/api/v1`:
  - `GET /folders`
  - `GET /folders/:id/children`
  - `GET /folders/search`
  - `GET /folders/:id/contents` (folders + files for right panel)
- Validate params/query using Elysia schema objects.
- Apply cursor-based pagination for children and contents endpoints.
- Add search endpoint with controlled limit and deterministic ordering.
- Add API response envelopes with metadata:
  - cursor / hasMore
  - requestId
  - optional debug timing fields in non-production
- Add baseline caching for hot read paths (initial load, root-level list).
- Add query performance checks (`EXPLAIN ANALYZE`) for large-tree scenarios.
- Add integration tests for each endpoint behavior + error mapping.

## Done criteria

- Endpoints return stable contracts and proper status codes.
- Large child lists are paginated with cursors (no offset bottlenecks).
- Search works within configured limits and documented ranking behavior.
- Observability exists for request duration and slow-query visibility.

## Vague edge cases (needs choice)

- **Caching mode:** in-memory cache first vs Redis from Phase 03 (trade-off: setup complexity vs multi-instance consistency).
- **Search semantics:** prefix-only, substring, or fuzzy ranking (impacts index strategy and UX expectations).
- **Pagination cursor format:** opaque signed token vs encoded last-seen tuple (security/compatibility trade-off).
- **Combined contents endpoint:** single endpoint for folders+files vs separate endpoints composed by frontend.
