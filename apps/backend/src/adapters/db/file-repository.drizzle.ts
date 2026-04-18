import { and, eq, isNull } from 'drizzle-orm';
import { FileNotDeletedError, FileNotFoundError } from '../../domain/errors';
import type { FileItem } from '../../domain/folder';
import type {
  FileRepository,
  RestoreFileInput,
  RestoreFileResult,
  SoftDeleteFileInput,
} from '../../ports/file-repository';
import { timed, type TimingConfig } from '../../infrastructure/timing';
import type { Db, DbTx } from './db';
import { files } from './schema';

type FileRow = typeof files.$inferSelect;

function mapFile(row: FileRow): FileItem {
  return {
    id: row.id,
    folderId: row.folderId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/**
 * Single-file repository adapter. Mirrors the soft-delete pattern of
 * `DrizzleFolderRepository.softDelete` but for one row only — no recursive
 * CTE, no subtree traversal. We rely on the `files_folder_id_idx` +
 * `files_deleted_at_idx` already declared in `schema.ts` so the writes hit
 * the index instead of scanning the whole table.
 */
export class DrizzleFileRepository implements FileRepository {
  constructor(
    private readonly handle: {
      readonly db: Db;
      withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
    },
    private readonly timing: TimingConfig,
  ) {}

  async getById(fileId: string): Promise<FileItem | null> {
    return timed('repo.files.getById', this.timing, async () => {
      const rows = await this.handle.db
        .select()
        .from(files)
        .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
        .limit(1);
      return rows[0] ? mapFile(rows[0]) : null;
    });
  }

  async getAnyById(fileId: string): Promise<FileItem | null> {
    // No `deleted_at` filter — used by restore. Single-row PK lookup so it
    // never benefits from the partial deleted-at index that getById uses.
    return timed('repo.files.getAnyById', this.timing, async () => {
      const rows = await this.handle.db
        .select()
        .from(files)
        .where(eq(files.id, fileId))
        .limit(1);
      return rows[0] ? mapFile(rows[0]) : null;
    });
  }

  async softDelete(input: SoftDeleteFileInput): Promise<void> {
    const { fileId, deletedAt } = input;
    await timed(
      'repo.files.softDelete',
      this.timing,
      () =>
        this.handle.withTransaction(async (tx) => {
          // Idempotent: rows that are already soft-deleted are filtered out
          // by the WHERE clause, so a retried DELETE is a no-op rather than
          // overwriting the original `deleted_at` (which would shift the
          // 30-day cleanup horizon for that row).
          await tx
            .update(files)
            .set({ deletedAt, updatedAt: deletedAt })
            .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
        }),
      { fileId },
    );
  }

  async restore(input: RestoreFileInput): Promise<RestoreFileResult> {
    const { fileId, restoredAt } = input;
    return timed(
      'repo.files.restore',
      this.timing,
      async () => {
        // Pre-check outside the tx (cheap PK lookup) so common error paths
        // skip BEGIN/ROLLBACK. The UPDATE below re-asserts via
        // `deleted_at = priorTs` so a concurrent restore between the read
        // and the write yields zero rows rather than a dirty overwrite.
        const preRows = await this.handle.db
          .select({ id: files.id, deletedAt: files.deletedAt })
          .from(files)
          .where(eq(files.id, fileId))
          .limit(1);
        const preRow = preRows[0];
        if (!preRow) {
          throw new FileNotFoundError(fileId);
        }
        if (preRow.deletedAt === null) {
          throw new FileNotDeletedError(fileId);
        }
        const priorDeletedAt = preRow.deletedAt;

        await this.handle.withTransaction(async (tx) => {
          await tx
            .update(files)
            .set({ deletedAt: null, updatedAt: restoredAt })
            .where(and(eq(files.id, fileId), eq(files.deletedAt, priorDeletedAt)));
        });

        return { priorDeletedAt };
      },
      { fileId },
    );
  }
}
