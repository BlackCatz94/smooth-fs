/**
 * Integration tests for Phase 2 repositories. See `test-helpers.ts` for the
 * strategy: ephemeral Docker Compose Postgres + per-test TRUNCATE isolation.
 * Skipped when the test DB is unreachable so `bun test` stays green locally.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { CleanupExpiredService } from '../../application/cleanup-expired';
import { GetFolderContentsService } from '../../application/get-folder-contents';
import { GetFolderPathService } from '../../application/get-folder-path';
import { ListFolderChildrenService } from '../../application/list-folder-children';
import { SoftDeleteFolderService } from '../../application/soft-delete-folder';
import { FolderNotFoundError } from '../../domain/errors';
import type { CleanupPort } from '../../ports/cleanup-repository';
import { createLogger } from '../../infrastructure/logger';
import type { TimingConfig } from '../../infrastructure/timing';
import { DrizzleCleanupRepository } from './cleanup-repository.drizzle';
import { DrizzleFolderRepository } from './folder-repository.drizzle';
import { files, folders } from './schema';
import { seedFixture } from './seed';
import { tryBuildHarness, type TestHarness } from './test-helpers';

let harness: TestHarness | null = null;
let timing: TimingConfig;

beforeAll(async () => {
  harness = await tryBuildHarness();
  if (harness) {
    timing = {
      logger: createLogger(harness.env).child({ component: 'db', test: true }),
      slowQueryMs: harness.env.DB_SLOW_QUERY_MS,
    };
  }
});

afterAll(async () => {
  if (harness) {
    await harness.close();
  }
});

beforeEach(async () => {
  if (harness) {
    await harness.reset();
  }
});

describe('DrizzleFolderRepository', () => {
  it('lists children with deterministic (name,id) ordering and stable cursors', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);

    await seedFixture(harness.handle, { depth: 0, width: 5, filesPerFolder: 0 });
    const listFolderChildren = new ListFolderChildrenService(repo);

    const firstPage = await listFolderChildren.exec({
      parentId: null,
      cursor: null,
      limit: 100,
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.name).toBe('root');

    const root = firstPage.items[0];
    if (!root) throw new Error('unreachable');

    const page1 = await listFolderChildren.exec({
      parentId: root.id,
      cursor: null,
      limit: 2,
    });
    expect(page1.items.map((f) => f.name)).toEqual(['wide-0000', 'wide-0001']);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listFolderChildren.exec({
      parentId: root.id,
      cursor: page1.nextCursor,
      limit: 2,
    });
    expect(page2.items.map((f) => f.name)).toEqual(['wide-0002', 'wide-0003']);

    const page3 = await listFolderChildren.exec({
      parentId: root.id,
      cursor: page2.nextCursor,
      limit: 10,
    });
    expect(page3.items.map((f) => f.name)).toEqual(['wide-0004']);
    expect(page3.nextCursor).toBeNull();
  });

  it('getFolderContents paginates folders and files with independent cursors', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 3,
      filesPerFolder: 0,
    });
    // Also attach files directly to the root so getFolderContents returns both.
    await harness.handle.db.insert(files).values([
      { folderId: rootId, name: 'a.txt' },
      { folderId: rootId, name: 'b.txt' },
      { folderId: rootId, name: 'c.txt' },
    ]);

    const first = await repo.getFolderContents({
      folderId: rootId,
      foldersCursor: null,
      filesCursor: null,
      limit: 2,
    });
    expect(first.folders.items.map((f) => f.name)).toEqual(['wide-0000', 'wide-0001']);
    expect(first.files.items.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
    expect(first.folders.nextCursor).not.toBeNull();
    expect(first.files.nextCursor).not.toBeNull();

    // Advance folders only; files cursor stays null → starts over.
    const second = await repo.getFolderContents({
      folderId: rootId,
      foldersCursor: first.folders.nextCursor,
      filesCursor: null,
      limit: 2,
    });
    expect(second.folders.items.map((f) => f.name)).toEqual(['wide-0002']);
    expect(second.folders.nextCursor).toBeNull();
    expect(second.files.items.map((f) => f.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('invalid cursor rejects with domain error', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    await expect(
      repo.listChildren({ parentId: null, cursor: 'not-a-valid-cursor', limit: 10 }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('getPathToRoot walks ancestry in root-first order and respects depth cap', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    const { rootId } = await seedFixture(harness.handle, {
      depth: 10,
      width: 0,
      filesPerFolder: 0,
    });

    const leaf = await harness.handle.db
      .select()
      .from(folders)
      .where(eq(folders.name, 'deep-0010'))
      .limit(1);
    const leafId = leaf[0]?.id;
    if (!leafId) throw new Error('seed did not produce deep-0010');

    const path = await repo.getPathToRoot(leafId, 64);
    expect(path[0]?.id).toBe(rootId);
    expect(path[path.length - 1]?.id).toBe(leafId);
    expect(path.map((f) => f.name)).toEqual([
      'root',
      ...Array.from({ length: 10 }, (_, i) => `deep-${String(i + 1).padStart(4, '0')}`),
    ]);

    // maxDepth=3 recurses 3 ancestors past the seed row, yielding 4 rows total
    // root-first: [deep-0007, deep-0008, deep-0009, deep-0010].
    const capped = await repo.getPathToRoot(leafId, 3);
    expect(capped).toHaveLength(4);
    expect(capped[0]?.name).toBe('deep-0007');
    expect(capped[capped.length - 1]?.id).toBe(leafId);
  });

  it('GetFolderPathService surfaces FolderNotFoundError for unknown ids', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    const service = new GetFolderPathService(repo, 64);
    await expect(
      service.exec({ folderId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toBeInstanceOf(FolderNotFoundError);
  });

  it('soft-delete cascades through subtree atomically; reads hide deleted rows', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 3,
      filesPerFolder: 4,
    });
    const softDelete = new SoftDeleteFolderService(repo, 64);
    const getContents = new GetFolderContentsService(repo);

    const initial = await getContents.exec({
      folderId: rootId,
      foldersCursor: null,
      filesCursor: null,
      limit: 100,
    });
    expect(initial.folders.items).toHaveLength(3);
    expect(initial.files.items).toHaveLength(0);

    const wideA = initial.folders.items.find((f) => f.name === 'wide-0000');
    if (!wideA) throw new Error('missing wide-0000');
    await softDelete.exec({ folderId: wideA.id });

    const after = await getContents.exec({
      folderId: rootId,
      foldersCursor: null,
      filesCursor: null,
      limit: 100,
    });
    expect(after.folders.items.map((f) => f.name)).toEqual(['wide-0001', 'wide-0002']);

    const visibleFilesForA = await harness.handle.db
      .select()
      .from(files)
      .where(and(eq(files.folderId, wideA.id), isNull(files.deletedAt)));
    expect(visibleFilesForA).toHaveLength(0);

    const softDeletedFilesForA = await harness.handle.db
      .select()
      .from(files)
      .where(eq(files.folderId, wideA.id))
      .orderBy(asc(files.name));
    expect(softDeletedFilesForA).toHaveLength(4);
    for (const row of softDeletedFilesForA) {
      expect(row.deletedAt).not.toBeNull();
    }
  });

});

describe('DrizzleCleanupRepository', () => {
  it('hard-deletes only rows older than retention, files before folders', async () => {
    if (!harness) return;
    const cleanupRepo = new DrizzleCleanupRepository(harness.handle, timing);
    await seedFixture(harness.handle, { depth: 0, width: 2, filesPerFolder: 2 });

    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const freshDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    await harness.handle.db
      .update(folders)
      .set({ deletedAt: oldDate })
      .where(eq(folders.name, 'wide-0000'));
    await harness.handle.db
      .update(files)
      .set({ deletedAt: oldDate })
      .where(
        eq(
          files.folderId,
          sql`(SELECT id FROM folders WHERE name = 'wide-0000' LIMIT 1)`,
        ),
      );
    await harness.handle.db
      .update(folders)
      .set({ deletedAt: freshDate })
      .where(eq(folders.name, 'wide-0001'));

    const service = new CleanupExpiredService(cleanupRepo);
    const result = await service.exec({ retentionDays: 30, batchSize: 100 });
    expect(result.filesDeleted).toBe(2);
    expect(result.foldersDeleted).toBe(1);

    const survivors = await harness.handle.db.select().from(folders);
    const names = survivors.map((f) => f.name).sort();
    expect(names).toEqual(['root', 'wide-0001']);
    const freshStillSoftDeleted = survivors.find((f) => f.name === 'wide-0001');
    expect(freshStillSoftDeleted?.deletedAt).not.toBeNull();
  });

  it('rolls back the whole batch when the folders delete fails', async () => {
    if (!harness) return;
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await seedFixture(harness.handle, { depth: 0, width: 2, filesPerFolder: 2 });
    await harness.handle.db.update(files).set({ deletedAt: oldDate });
    await harness.handle.db
      .update(folders)
      .set({ deletedAt: oldDate })
      .where(eq(folders.name, 'wide-0000'));

    // Fault-inject a cleanup port that executes the real files-delete inside
    // the tx, then throws before the folders-delete. The partial change must
    // be rolled back, so files that would have been purged must still exist.
    const realRepo = new DrizzleCleanupRepository(harness.handle, timing);
    const failingCleanup: CleanupPort = {
      cleanupExpired: async (input) =>
        harness!.handle.withTransaction(async (tx) => {
          await tx.execute(sql`
            DELETE FROM files
            WHERE deleted_at IS NOT NULL
              AND deleted_at < ${input.olderThan.toISOString()}::timestamptz
          `);
          throw new Error('injected failure before folders delete');
        }),
    };

    const filesBefore = await harness.handle.db.select().from(files);
    await expect(
      failingCleanup.cleanupExpired({ olderThan: new Date(), batchSize: 100 }),
    ).rejects.toThrow(/injected failure/);
    const filesAfter = await harness.handle.db.select().from(files);
    expect(filesAfter).toHaveLength(filesBefore.length);

    // The real repo still works on the same data and completes successfully.
    const ok = await realRepo.cleanupExpired({
      olderThan: new Date(),
      batchSize: 100,
    });
    expect(ok.filesDeleted).toBeGreaterThan(0);
  });
});
