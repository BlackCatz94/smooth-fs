import { decodeCursor, encodeCursor } from '@smoothfs/shared';
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { DepthLimitExceededError, InvalidCursorError } from '../../domain/errors';
import type { FileItem, Folder } from '../../domain/folder';
import type {
  FolderContents,
  FolderRepository,
  GetFolderContentsInput,
  ListChildrenInput,
  Page,
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

  restore(_folderId: string): Promise<void> {
    // Intentional: restore is declared on the port but its implementation is
    // deferred to Phase 3+. Failing loudly here prevents accidental consumption.
    return Promise.reject(
      new Error('FolderRepository.restore is not implemented in Phase 2'),
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
