import type { CleanupPort } from '../ports/cleanup-repository';

export interface CleanupExpiredInput {
  /** Retention window in days; rows with deletedAt older than this are purged. */
  readonly retentionDays: number;
  /** Upper bound of rows purged per table inside the single batch transaction. */
  readonly batchSize: number;
}

export interface CleanupExpiredResult {
  readonly filesDeleted: number;
  readonly foldersDeleted: number;
  readonly olderThan: string;
}

/**
 * Use-case invoked by the BullMQ cleanup worker. The underlying adapter runs
 * files-then-folders deletes inside one transaction so a partial failure cannot
 * leave the tree inconsistent (plan §7).
 */
export class CleanupExpiredService {
  constructor(
    private readonly cleanup: CleanupPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exec(input: CleanupExpiredInput): Promise<CleanupExpiredResult> {
    const olderThan = new Date(
      this.now().getTime() - input.retentionDays * 24 * 60 * 60 * 1000,
    );
    const { filesDeleted, foldersDeleted } = await this.cleanup.cleanupExpired({
      olderThan,
      batchSize: input.batchSize,
    });
    return {
      filesDeleted,
      foldersDeleted,
      olderThan: olderThan.toISOString(),
    };
  }
}
