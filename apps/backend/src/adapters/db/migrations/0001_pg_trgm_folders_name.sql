-- Phase 3: enable substring-search support for folder names.
-- pg_trgm + GIN index turns `ILIKE '%q%'` into an index-accelerated lookup,
-- which is what the Phase 3 plan locks in for Explorer-style "contains" UX.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS folders_name_trgm_idx
  ON folders
  USING GIN (name gin_trgm_ops);
