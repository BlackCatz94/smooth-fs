-- Phase 4 / audit remediation T12: keyset-pagination indexes.
--
-- Every list endpoint orders by `(name ASC, id ASC)` and filters live rows via
-- `deleted_at IS NULL`, so a partial b-tree on that triple lets Postgres satisfy
-- the page+1 scan with an index-only lookup instead of a seq scan + sort.
--
-- Rationale for each index:
--   * folders(parent_id, name, id) WHERE deleted_at IS NULL
--       Children listing (`listChildren`) uses this for both NULL (root) and
--       explicit parents; the partial predicate skips tombstoned rows without
--       a Bitmap AND against `folders_deleted_at_idx`.
--
--   * folders(name, id) WHERE deleted_at IS NULL
--       Search (`searchFolders`) filters by `name ILIKE '%q%'` (handled by the
--       existing pg_trgm GIN index) then orders by name,id — this b-tree gives
--       the planner an ordered path for the final sort.
--
--   * files(folder_id, name, id) WHERE deleted_at IS NULL
--       `listFilesOf` is the files equivalent of the children listing above.
--
-- `CREATE INDEX IF NOT EXISTS` keeps the migration idempotent if an operator
-- pre-created one of these by hand. All three are plain CREATE (not
-- CONCURRENTLY) because this project targets dev-sized datasets and the
-- migration runs inside a transaction; swap to CONCURRENTLY at scale.
CREATE INDEX IF NOT EXISTS folders_parent_name_id_live_idx
  ON folders (parent_id, name, id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS folders_name_id_live_idx
  ON folders (name, id)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS files_folder_name_id_live_idx
  ON files (folder_id, name, id)
  WHERE deleted_at IS NULL;
