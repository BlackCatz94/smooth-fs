# Phase 02 — Database and Backend Architecture

## Objective

Establish PostgreSQL schema and hexagonal backend structure that supports unlimited folder depth and clean service boundaries.

## Project-core alignment

- **Smooth:** adjacency-list + indexed recursive queries prevent expensive traversal patterns.
- **Reliable:** strict domain/port/adapter boundaries reduce coupling and accidental regressions.
- **Debuggable:** typed domain errors and request-scoped metadata make failures traceable.

## Tasks

- Provision PostgreSQL locally for development.
- Choose ORM implementation (default: Drizzle ORM) and create migration baseline.
- Implement adjacency-list schema:
  - `folders(id, parent_id, name, created_at, updated_at)`
  - `files(id, folder_id, name, created_at, updated_at)`
- Add required indexes:
  - `folders(parent_id)`
  - `folders(parent_id, name)`
  - `files(folder_id)`
  - optional trigram indexes when fuzzy search is enabled
- Scaffold backend layers:
  - `domain/`
  - `application/`
  - `ports/`
  - `adapters/db/`
  - `adapters/http/`
  - `infrastructure/`
- Add base repository ports for folder/file access.
- Add DB adapter implementations behind ports.
- Implement recursive CTE query templates with depth caps.
- Add global error mapping (domain errors to HTTP) and request ID propagation.

## Done criteria

- Migrations run cleanly and schema matches expected model.
- Recursive query works for deep trees with bounded depth.
- Services depend on ports only; adapters are replaceable.
- Backend boots with validated env and structured logs.

## Vague edge cases (needs choice)

- **ORM decision:** Drizzle vs Prisma (trade-off: runtime weight and SQL control vs ecosystem tooling).
- **Recursive query strategy boundary:** one generalized CTE utility vs endpoint-specific CTE queries.
- **Delete semantics:** hard cascade delete vs soft delete + background cleanup for folders/files.
- **Root modeling:** `parent_id = NULL` roots vs synthetic root node (affects query ergonomics and API shape).

User's Choice:
- Drizzle ORM
- Endpoint specific CTE queries (encapsulated in the repository layer)
- Soft delete + background cleanup
- parent_id = NULL for root folders

Follow-up decision:
- Use BullMQ + Redis for cron job
