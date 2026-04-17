import { decodeCursor, encodeCursor } from '@smoothfs/shared';
import { and, asc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  DepthLimitExceededError,
  FolderNotDeletedError,
  FolderNotFoundError,
  InvalidCursorError,
} from '../../domain/errors';
import type { FileItem, Folder } from '../../domain/folder';
import type {
  FolderContents,
  FolderRepository,
  GetFolderContentsInput,
  ListChildrenInput,
  Page,
  RestoreFolderInput,
  RestoreFolderResult,
  SearchFoldersInput,
  SoftDeleteFolderInput,
} from '../../ports/folder-repository';
import { timed, type TimingConfig } from '../../infrastructure/timing';
import type { Db, DbTx } from './db';
import { files, folders } from './schema';

type FolderRow = typeof folders.$inferSelect;
type FileRow = typeof files.$inferSelect;

interface CursorTuple {
  readonly name: string;
  readonly id: string;
}

function toCursor(row: { name: string; id: string }): string {
  return encodeCursor([row.name, row.id]);
}

/**
 * Escape `%` and `_` in a user-supplied query so they can't be interpreted as
 * LIKE wildcards once we wrap the value in `%…%` for substring search.
 * Backslash is used as an escape char; the default `ILIKE` grammar honours it
 * unless a non-default `ESCAPE` clause overrides it, which we don't use.
 */
function escapeLikeWildcards(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function parseCursor(raw: string | null): CursorTuple | null {
  if (raw === null) {
    return null;
  }
  try {
    const tuple = decodeCursor(raw);
    const name = tuple[0];
    const id = tuple[1];
    if (tuple.length !== 2 || name === undefined || id === undefined) {
      throw new Error('expected [name, id]');
    }
    return { name, id };
  } catch (err) {
    throw new InvalidCursorError(err instanceof Error ? err.message : 'malformed');
  }
}

function mapFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

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

export class DrizzleFolderRepository implements FolderRepository {
  constructor(
    private readonly handle: {
      readonly db: Db;
      withTransaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T>;
    },
    private readonly timing: TimingConfig,
  ) {}

  async listChildren(input: ListChildrenInput): Promise<Page<Folder>> {
    return timed(
      'repo.folders.listChildren',
      this.timing,
      () => this.listChildrenOn(this.handle.db, input),
      { parentId: input.parentId ?? null, limit: input.limit },
    );
  }

  async getById(folderId: string): Promise<Folder | null> {
    return timed('repo.folders.getById', this.timing, async () => {
      const rows = await this.handle.db
        .select()
        .from(folders)
        .where(and(eq(folders.id, folderId), isNull(folders.deletedAt)))
        .limit(1);
      return rows[0] ? mapFolder(rows[0]) : null;
    });
  }

  /**
   * Breadcrumb ancestry via recursive CTE (child → parent). `maxDepth` caps the
   * recursion to protect against runaway traversal or cycles. Root-first order.
   */
  async getPathToRoot(folderId: string, maxDepth: number): Promise<readonly Folder[]> {
    if (maxDepth < 1) {
      throw new DepthLimitExceededError(maxDepth, maxDepth);
    }
    return timed(
      'repo.folders.getPathToRoot',
      this.timing,
      async () => {
        const rows = await this.handle.db.execute<FolderRow & { depth: number }>(sql`
          WITH RECURSIVE path AS (
            SELECT f.*, 0 AS depth
            FROM folders f
            WHERE f.id = ${folderId} AND f.deleted_at IS NULL
            UNION ALL
            SELECT p.*, path.depth + 1
            FROM folders p
            JOIN path ON p.id = path.parent_id
            WHERE p.deleted_at IS NULL AND path.depth < ${maxDepth}
          )
          SELECT id, parent_id AS "parentId", name, created_at AS "createdAt",
                 updated_at AS "updatedAt", deleted_at AS "deletedAt", depth
          FROM path
          ORDER BY depth DESC
        `);
        return rows.map(mapFolder);
      },
      { folderId, maxDepth },
    );
  }

  async getFolderContents(input: GetFolderContentsInput): Promise<FolderContents> {
    return timed(
      'repo.folders.getFolderContents',
      this.timing,
      async () => {
        const [foldersPage, filesPage] = await Promise.all([
          this.listChildrenOn(this.handle.db, {
            parentId: input.folderId,
            cursor: input.foldersCursor,
            limit: input.limit,
          }),
          this.listFilesOf(input.folderId, input.filesCursor, input.limit),
        ]);
        return { folders: foldersPage, files: filesPage };
      },
      { folderId: input.folderId, limit: input.limit },
    );
  }

  async softDelete(input: SoftDeleteFolderInput): Promise<void> {
    const { folderId, deletedAt, maxDepth } = input;
    // postgres-js binds Date params via prepared statements inconsistently in
    // raw CTEs; cast an ISO string to timestamptz so the server does the parse.
    const ts = deletedAt.toISOString();
    await timed(
      'repo.folders.softDelete',
      this.timing,
      () =>
        this.handle.withTransaction(async (tx) => {
          const existing = await tx
            .select({ id: folders.id })
            .from(folders)
            .where(and(eq(folders.id, folderId), isNull(folders.deletedAt)))
            .limit(1);
          if (existing.length === 0) {
            return;
          }
          await tx.execute(sql`
            WITH RECURSIVE subtree AS (
              SELECT id, 0 AS depth
              FROM folders
              WHERE id = ${folderId} AND deleted_at IS NULL
              UNION ALL
              SELECT f.id, s.depth + 1
              FROM folders f
              JOIN subtree s ON f.parent_id = s.id
              WHERE f.deleted_at IS NULL AND s.depth < ${maxDepth}
            )
            UPDATE files
            SET deleted_at = ${ts}::timestamptz, updated_at = ${ts}::timestamptz
            WHERE folder_id IN (SELECT id FROM subtree) AND deleted_at IS NULL
          `);
          await tx.execute(sql`
            WITH RECURSIVE subtree AS (
              SELECT id, 0 AS depth
              FROM folders
              WHERE id = ${folderId} AND deleted_at IS NULL
              UNION ALL
              SELECT f.id, s.depth + 1
              FROM folders f
              JOIN subtree s ON f.parent_id = s.id
              WHERE f.deleted_at IS NULL AND s.depth < ${maxDepth}
            )
            UPDATE folders
            SET deleted_at = ${ts}::timestamptz, updated_at = ${ts}::timestamptz
            WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL
          `);
        }),
      { folderId, maxDepth },
    );
  }

  async searchFolders(input: SearchFoldersInput): Promise<Page<Folder>> {
    return timed(
      'repo.folders.search',
      this.timing,
      async () => {
        const pattern = `%${escapeLikeWildcards(input.query)}%`;
        const cursor = parseCursor(input.cursor);
        const keyset =
          cursor === null
            ? undefined
            : or(
                gt(folders.name, cursor.name),
                and(eq(folders.name, cursor.name), gt(folders.id, cursor.id)),
              );
        const where = keyset
          ? and(isNull(folders.deletedAt), ilike(folders.name, pattern), keyset)
          : and(isNull(folders.deletedAt), ilike(folders.name, pattern));

        const rows = await this.handle.db
          .select()
          .from(folders)
          .where(where)
          .orderBy(asc(folders.name), asc(folders.id))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const page = hasMore ? rows.slice(0, input.limit) : rows;
        const last = page[page.length - 1];
        return {
          items: page.map(mapFolder),
          nextCursor:
            hasMore && last ? toCursor({ name: last.name, id: last.id }) : null,
        };
      },
      { limitPlusOne: input.limit + 1, hasCursor: input.cursor !== null },
    );
  }

  async restore(input: RestoreFolderInput): Promise<RestoreFolderResult> {
    const { folderId, restoredAt, maxDepth } = input;
    // Same Date → ISO pattern as softDelete so the server parses the value
    // once per batch instead of the driver re-binding per parameter.
    const ts = restoredAt.toISOString();
    return timed(
      'repo.folders.restore',
      this.timing,
      async () => {
        // Pre-check outside the transaction: lets us short-circuit the
        // common error paths without paying BEGIN/ROLLBACK cost and avoids
        // the "throw inside tx callback" shape that some drivers are touchy
        // about under load. The tx below *re-asserts* via `deleted_at = prior`
        // so a concurrent restore between the pre-check and the UPDATE just
        // yields zero rows rather than a dirty write.
        const preRows = await this.handle.db
          .select({ id: folders.id, deletedAt: folders.deletedAt })
          .from(folders)
          .where(eq(folders.id, folderId))
          .limit(1);
        const preRow = preRows[0];
        if (!preRow) {
          throw new FolderNotFoundError(folderId);
        }
        if (preRow.deletedAt === null) {
          throw new FolderNotDeletedError(folderId);
        }
        const priorDeletedAt = preRow.deletedAt;
        const priorTs = priorDeletedAt.toISOString();

        return this.handle.withTransaction(async (tx) => {
          // Walk the subtree *through* soft-deleted rows (the target and its
          // cascaded descendants are all tombstoned). The `deleted_at = prior`
          // filter keeps earlier, unrelated soft-delete events untouched.
          const filesRestored = await tx.execute<{ id: string }>(sql`
            WITH RECURSIVE subtree AS (
              SELECT id, 0 AS depth
              FROM folders
              WHERE id = ${folderId}
              UNION ALL
              SELECT f.id, s.depth + 1
              FROM folders f
              JOIN subtree s ON f.parent_id = s.id
              WHERE s.depth < ${maxDepth}
            )
            UPDATE files
            SET deleted_at = NULL, updated_at = ${ts}::timestamptz
            WHERE folder_id IN (SELECT id FROM subtree)
              AND deleted_at = ${priorTs}::timestamptz
            RETURNING id
          `);

          const foldersRestored = await tx.execute<{ id: string }>(sql`
            WITH RECURSIVE subtree AS (
              SELECT id, 0 AS depth
              FROM folders
              WHERE id = ${folderId}
              UNION ALL
              SELECT f.id, s.depth + 1
              FROM folders f
              JOIN subtree s ON f.parent_id = s.id
              WHERE s.depth < ${maxDepth}
            )
            UPDATE folders
            SET deleted_at = NULL, updated_at = ${ts}::timestamptz
            WHERE id IN (SELECT id FROM subtree)
              AND deleted_at = ${priorTs}::timestamptz
            RETURNING id
          `);

          return {
            foldersRestored: foldersRestored.length,
            filesRestored: filesRestored.length,
            priorDeletedAt,
          };
        });
      },
      { folderId, maxDepth },
    );
  }

  private async listChildrenOn(
    exec: Db | DbTx,
    input: ListChildrenInput,
  ): Promise<Page<Folder>> {
    const parentCond =
      input.parentId === null
        ? isNull(folders.parentId)
        : eq(folders.parentId, input.parentId);
    const cursor = parseCursor(input.cursor);
    const keyset =
      cursor === null
        ? undefined
        : or(
            gt(folders.name, cursor.name),
            and(eq(folders.name, cursor.name), gt(folders.id, cursor.id)),
          );
    const where = keyset
      ? and(parentCond, isNull(folders.deletedAt), keyset)
      : and(parentCond, isNull(folders.deletedAt));

    const rows = await exec
      .select()
      .from(folders)
      .where(where)
      .orderBy(asc(folders.name), asc(folders.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(mapFolder),
      nextCursor: hasMore && last ? toCursor({ name: last.name, id: last.id }) : null,
    };
  }

  private async listFilesOf(
    folderId: string,
    rawCursor: string | null,
    limit: number,
  ): Promise<Page<FileItem>> {
    const cursor = parseCursor(rawCursor);
    const keyset =
      cursor === null
        ? undefined
        : or(
            gt(files.name, cursor.name),
            and(eq(files.name, cursor.name), gt(files.id, cursor.id)),
          );
    const where = keyset
      ? and(eq(files.folderId, folderId), isNull(files.deletedAt), keyset)
      : and(eq(files.folderId, folderId), isNull(files.deletedAt));

    const rows = await this.handle.db
      .select()
      .from(files)
      .where(where)
      .orderBy(asc(files.name), asc(files.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(mapFile),
      nextCursor: hasMore && last ? toCursor({ name: last.name, id: last.id }) : null,
    };
  }
}
