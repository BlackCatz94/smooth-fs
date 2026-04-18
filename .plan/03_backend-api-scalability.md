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
  - `DELETE /folders/:id` (soft-delete folder + subtree)
  - `POST /folders/:id/restore` (undo soft-delete; consumes the `restoreFolder` port declared in Phase 2)
  - `DELETE /files/:id` (soft-delete a single file row; segregated `FileRepository` port)
  - `POST /files/:id/restore` (undo a single-file soft-delete; pairs with the frontend "Undo" toast)
- Validate params/query using Elysia schema objects.
- Apply cursor-based pagination for children and contents endpoints.
- Add search endpoint with controlled limit and deterministic ordering.
- Add API response envelopes with metadata:
  - cursor / hasMore
  - requestId
  - optional debug timing fields in non-production
- Add trigram support deferred from Phase 2:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm` migration
  - GIN trigram index on `folders(name)` (and `files(name)` if in-scope for this phase's search)
- Add baseline caching for hot read paths (initial load, root-level list), reusing the Phase 2 Redis instance with a distinct key prefix (e.g. `cache:*`) and ideally a separate logical DB from BullMQ (`bull:*`).
- Add query performance checks (`EXPLAIN ANALYZE`) for large-tree scenarios and for trigram-backed search.
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

User's Choice:
- Definitely Redis (shared with Phase 2 BullMQ; separated by key prefix / logical DB)
- Substring search backed by a `pg_trgm` GIN index (fuzzy ranking rejected as overkill for a filesystem clone: predictable index build, sub-100ms on millions of rows, matches Explorer "contains" UX)
- Encoded last-seen tuple (cursor type lives in `@smoothfs/shared`)
- Single endpoint for folders + files

Follow-up decision:
- Restore lands in Phase 3: implement `restoreFolder` adapter + service and expose `POST /folders/:id/restore` (clears `deleted_at` on folder + descendants in a single transaction, mirroring the soft-delete boundary).
- Per-file soft-delete (`DELETE /files/:id`) lives behind its own `FileRepository` port (Interface Segregation): folder-tree use-cases never need single-file CRUD, and the file repo never needs subtree traversal. Cache invalidation reuses the `cache:folders:*` namespace because a single file mutation invalidates that folder's cached `getFolderContents` payload.
- Per-file restore (`POST /files/:id/restore`) ships alongside the delete so the frontend's "Undo" toast can target the exact row the user just deleted, not just events that also touched a parent folder. The port grows a `restore(input)` method and a `getAnyById` reader (restore needs to *find* tombstones that `getById` filters out); the adapter does the same pre-check + `deleted_at = prior` UPDATE pattern as folder restore so concurrent restores can't dirty-write. A new `FileNotDeletedError` (409) mirrors `FolderNotDeletedError`.