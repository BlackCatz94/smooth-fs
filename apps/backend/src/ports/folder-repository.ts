import type { FileItem, Folder } from '../domain/folder';

/** Page shape returned by list ports. `nextCursor === null` means no more rows. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface ListChildrenInput {
  /** `null` for root-level folders (locked decision: parent_id = NULL). */
  readonly parentId: string | null;
  /** Opaque cursor produced by a previous call (encoded last-seen tuple). */
  readonly cursor: string | null;
  /** Caller-clamped upper bound (controller enforces hard cap). */
  readonly limit: number;
}

export interface FolderContents {
  readonly folders: Page<Folder>;
  readonly files: Page<FileItem>;
}

export interface GetFolderContentsInput {
  readonly folderId: string;
  /** Independent keyset cursors so folders and files paginate separately. */
  readonly foldersCursor: string | null;
  readonly filesCursor: string | null;
  readonly limit: number;
}

export interface SoftDeleteFolderInput {
  readonly folderId: string;
  /** Provided by the service so the adapter can stamp a single "now" across a tx. */
  readonly deletedAt: Date;
  /** Subtree traversal depth cap (from env.MAX_TREE_DEPTH). */
  readonly maxDepth: number;
}

export interface SearchFoldersInput {
  /** Free-text substring query (already trimmed + validated by the service). */
  readonly query: string;
  /** Opaque keyset cursor (encoded last-seen `(name, id)` tuple). */
  readonly cursor: string | null;
  /** Caller-clamped upper bound (controller enforces hard cap). */
  readonly limit: number;
}

export interface RestoreFolderInput {
  readonly folderId: string;
  /** Stamped once by the service so the entire subtree shares a single `updatedAt`. */
  readonly restoredAt: Date;
  /** Subtree traversal depth cap (from env.MAX_TREE_DEPTH). */
  readonly maxDepth: number;
}

export interface RestoreFolderResult {
  readonly foldersRestored: number;
  readonly filesRestored: number;
  /** The timestamp previously stamped by soft-delete. `null` if target wasn't deleted. */
  readonly priorDeletedAt: Date | null;
}

/**
 * Port for folder tree access. All reads hide soft-deleted rows by default;
 * methods that operate on soft-deleted rows are named explicitly. Hard-delete
 * of expired rows lives on `CleanupPort` (see `ports/cleanup-repository.ts`)
 * so both tables can be purged inside one transactional batch.
 */
export interface FolderRepository {
  listChildren(input: ListChildrenInput): Promise<Page<Folder>>;
  getById(folderId: string): Promise<Folder | null>;
  getPathToRoot(folderId: string, maxDepth: number): Promise<readonly Folder[]>;
  getFolderContents(input: GetFolderContentsInput): Promise<FolderContents>;

  /**
   * Keyset-paginated substring search on folder name. Trigram GIN index
   * (`folders_name_trgm_idx`) makes `name ILIKE '%q%'` index-accelerated;
   * ordering is `(name, id)` for deterministic keyset pagination.
   */
  searchFolders(input: SearchFoldersInput): Promise<Page<Folder>>;

  /**
   * Soft-deletes `folderId` and its entire subtree (folders + files), atomically.
   */
  softDelete(input: SoftDeleteFolderInput): Promise<void>;

  /**
   * Transactional subtree restore. Undoes a single soft-delete event: all
   * descendants that share the target folder's `deletedAt` timestamp are
   * un-deleted in the same transaction. Rows that were deleted in a
   * *different* event keep their tombstone so restore stays idempotent
   * relative to a specific soft-delete occurrence.
   *
   * Throws `FolderNotDeletedError` if the target folder is not soft-deleted;
   * throws `FolderNotFoundError` if it does not exist at all.
   */
  restore(input: RestoreFolderInput): Promise<RestoreFolderResult>;
}
