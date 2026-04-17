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
   * Soft-deletes `folderId` and its entire subtree (folders + files), atomically.
   */
  softDelete(input: SoftDeleteFolderInput): Promise<void>;

  /**
   * Restore semantics are declared on the port but **NOT** implemented in
   * Phase 2. The adapter and service layers will implement this in Phase 3+.
   * Calling it now must throw so accidental usage fails loudly.
   */
  restore(folderId: string): Promise<void>;
}
