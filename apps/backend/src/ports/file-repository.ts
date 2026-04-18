import type { FileItem } from '../domain/folder';

export interface SoftDeleteFileInput {
  readonly fileId: string;
  /** Provided by the service so the adapter stamps a single "now". */
  readonly deletedAt: Date;
}

export interface RestoreFileInput {
  readonly fileId: string;
  /** Stamped once by the service so the file's `updatedAt` reflects undo time. */
  readonly restoredAt: Date;
}

export interface RestoreFileResult {
  /**
   * The timestamp the row carried before restore — useful for telemetry and
   * for clients that need to reconcile a stale "Undo" with concurrent edits.
   * `null` should be unreachable in practice (the service pre-checks) but is
   * kept symmetric with `RestoreFolderResult` for a uniform port contract.
   */
  readonly priorDeletedAt: Date | null;
}

/**
 * Port for individual file rows.
 *
 * Segregated from `FolderRepository` (Interface Segregation): folder-tree
 * use-cases (list children, get path, search, soft-delete subtree, restore)
 * never need single-file CRUD; conversely, `softDeleteFile` would force every
 * folder-only consumer to know about a method it doesn't call. Two ports
 * keep both surfaces minimal and let us test/replace them independently.
 *
 * Cascading folder deletes still go through `FolderRepository.softDelete` —
 * this port is the *single-file* counterpart used by `DELETE /files/:id`.
 */
export interface FileRepository {
  /** Returns `null` for unknown ids and for already soft-deleted rows. */
  getById(fileId: string): Promise<FileItem | null>;

  /**
   * Read variant that returns soft-deleted rows. Required by the restore
   * service: `getById` deliberately filters tombstones, but restore needs
   * to *find* them to undo the delete. Returns `null` only for unknown ids.
   */
  getAnyById(fileId: string): Promise<FileItem | null>;

  /**
   * Stamps `deleted_at` (and `updated_at`) on the file row. Idempotent: a
   * row that is already soft-deleted is treated as a no-op rather than an
   * error so retried DELETEs stay safe under at-least-once delivery.
   */
  softDelete(input: SoftDeleteFileInput): Promise<void>;

  /**
   * Clears `deleted_at` on a single file row. The adapter must guard against
   * concurrent restores by filtering on the prior `deleted_at`, mirroring
   * `FolderRepository.restore`'s "scope to a single delete event" semantics.
   *
   * Throws `FileNotFoundError` when the id doesn't exist; throws
   * `FileNotDeletedError` when the row is already live. Both checks live
   * here (not just the service) so the adapter remains the single source of
   * truth for state transitions, even if a future caller bypasses the service.
   */
  restore(input: RestoreFileInput): Promise<RestoreFileResult>;
}
