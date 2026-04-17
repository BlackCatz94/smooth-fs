import { sql } from 'drizzle-orm';
import type {
  CleanupExpiredPortInput,
  CleanupExpiredPortResult,
  CleanupPort,
} from '../../ports/cleanup-repository';
import { timed, type TimingConfig } from '../../infrastructure/timing';
import type { DbHandle } from './db';

export class DrizzleCleanupRepository implements CleanupPort {
  constructor(
    private readonly handle: DbHandle,
    private readonly timing: TimingConfig,
  ) {}

  async cleanupExpired(
    input: CleanupExpiredPortInput,
  ): Promise<CleanupExpiredPortResult> {
    const ts = input.olderThan.toISOString();
    return timed(
      'repo.cleanup.expired',
      this.timing,
      async () =>
        this.handle.withTransaction(async (tx) => {
          // Files first: with ON DELETE CASCADE on folders it is defensive, but
          // the plan mandates this order explicitly for safety against future
          // schema changes. Both statements share the tx, so a failure in
          // either rolls back everything.
          const filesDeleted = await tx.execute<{ id: string }>(sql`
            DELETE FROM files
            WHERE id IN (
              SELECT id FROM files
              WHERE deleted_at IS NOT NULL AND deleted_at < ${ts}::timestamptz
              ORDER BY deleted_at ASC
              LIMIT ${input.batchSize}
            )
            RETURNING id
          `);

          const foldersDeleted = await tx.execute<{ id: string }>(sql`
            DELETE FROM folders
            WHERE id IN (
              SELECT id FROM folders
              WHERE deleted_at IS NOT NULL AND deleted_at < ${ts}::timestamptz
              ORDER BY deleted_at ASC
              LIMIT ${input.batchSize}
            )
            RETURNING id
          `);

          return {
            filesDeleted: filesDeleted.length,
            foldersDeleted: foldersDeleted.length,
          };
        }),
      { batchSize: input.batchSize, olderThan: ts },
    );
  }
}
