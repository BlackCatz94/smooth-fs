import { z } from 'zod';
import { fileNodeSchema, folderNodeSchema } from './folder';

/**
 * Phase 3 HTTP boundary schemas. Request shapes validate query / params /
 * body at the controller; response shapes double as runtime checks in tests
 * so boundary drift fails loudly rather than leaking bad data to the client.
 *
 * Keep limit caps tight so a pathological caller can't ask for a 1M-row page.
 */

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 200;
export const SEARCH_DEFAULT_LIMIT = 50;
export const SEARCH_MAX_LIMIT = 100;

const optionalCursor = z.string().min(1).max(2048).nullable().optional();

/** Shared pagination query for the single-cursor list endpoints. */
export const paginationQuerySchema = z.object({
  cursor: optionalCursor,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIST_MAX_LIMIT)
    .default(LIST_DEFAULT_LIMIT),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Dual-cursor query for `GET /api/v1/folders/:id/contents`. */
export const contentsQuerySchema = z.object({
  foldersCursor: optionalCursor,
  filesCursor: optionalCursor,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIST_MAX_LIMIT)
    .default(LIST_DEFAULT_LIMIT),
});
export type ContentsQuery = z.infer<typeof contentsQuerySchema>;

/** Substring search query. `q` is required; min length mirrors service. */
export const searchQuerySchema = z.object({
  q: z.string().min(2).max(100),
  cursor: optionalCursor,
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_MAX_LIMIT)
    .default(SEARCH_DEFAULT_LIMIT),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** UUID path param used by every `/folders/:id/*` endpoint. */
export const folderIdParamSchema = z.object({
  id: z.string().uuid(),
});
export type FolderIdParam = z.infer<typeof folderIdParamSchema>;

/** UUID path param used by `/files/:id` endpoints. Mirrors folder shape so
 * controllers stay symmetric, but the type is intentionally distinct so a
 * folder-id can't be accidentally passed where a file-id is expected. */
export const fileIdParamSchema = z.object({
  id: z.string().uuid(),
});
export type FileIdParam = z.infer<typeof fileIdParamSchema>;

/* -------------------------- response data shapes -------------------------- */

export const folderListDataSchema = z.object({
  items: z.array(folderNodeSchema),
});
export type FolderListData = z.infer<typeof folderListDataSchema>;

const folderPageSchema = z.object({
  items: z.array(folderNodeSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const filePageSchema = z.object({
  items: z.array(fileNodeSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const folderContentsDataSchema = z.object({
  folders: folderPageSchema,
  files: filePageSchema,
});
export type FolderContentsData = z.infer<typeof folderContentsDataSchema>;

export const folderSearchDataSchema = z.object({
  items: z.array(folderNodeSchema),
  query: z.string(),
});
export type FolderSearchData = z.infer<typeof folderSearchDataSchema>;

export const folderRestoreDataSchema = z.object({
  id: z.string().uuid(),
  foldersRestored: z.number().int().min(0),
  filesRestored: z.number().int().min(0),
  priorDeletedAt: z.string().datetime().nullable(),
});
export type FolderRestoreData = z.infer<typeof folderRestoreDataSchema>;

/**
 * Single-file restore envelope. Symmetric with `folderRestoreDataSchema` so
 * the frontend's "Undo delete" toast can treat both responses uniformly.
 * `priorDeletedAt` is the timestamp the row carried *before* restore — useful
 * for telemetry / debugging stale-undo scenarios.
 */
export const fileRestoreDataSchema = z.object({
  id: z.string().uuid(),
  priorDeletedAt: z.string().datetime().nullable(),
});
export type FileRestoreData = z.infer<typeof fileRestoreDataSchema>;

export const folderPathDataSchema = z.object({
  items: z.array(folderNodeSchema),
});
export type FolderPathData = z.infer<typeof folderPathDataSchema>;
