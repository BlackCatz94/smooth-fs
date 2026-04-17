export interface CleanupExpiredPortInput {
  /** Rows with `deletedAt` strictly before this are eligible for hard delete. */
  readonly olderThan: Date;
  /** Maximum rows purged per table in a single transactional batch. */
  readonly batchSize: number;
}

export interface CleanupExpiredPortResult {
  readonly filesDeleted: number;
  readonly foldersDeleted: number;
}

/**
 * Single-batch purge of soft-deleted rows. The adapter must run `files` deletes
 * followed by `folders` deletes inside ONE transaction so a partial failure
 * cannot leave the tree inconsistent (plan §7).
 */
export interface CleanupPort {
  cleanupExpired(input: CleanupExpiredPortInput): Promise<CleanupExpiredPortResult>;
}
