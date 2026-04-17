/**
 * Phase 3 repository-level integration tests: substring search + transactional
 * restore, plus an EXPLAIN ANALYZE probe that the trigram GIN index is
 * actually picked up by the planner.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  FolderNotDeletedError,
  FolderNotFoundError,
} from '../../domain/errors';
import { createLogger } from '../../infrastructure/logger';
import type { TimingConfig } from '../../infrastructure/timing';
import { SearchFoldersService } from '../../application/search-folders';
import { SoftDeleteFolderService } from '../../application/soft-delete-folder';
import { RestoreFolderService } from '../../application/restore-folder';
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

describe('DrizzleFolderRepository.searchFolders', () => {
  it('returns deterministic keyset-paginated matches (name,id asc)', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    // 20 names containing "report-" so keyset cursors must be stable.
    await seedFixture(harness.handle, { depth: 0, width: 0, filesPerFolder: 0 });
    const [root] = await harness.handle.db
      .select({ id: folders.id })
      .from(folders)
      .limit(1);
    const rootId = root!.id;
    await harness.handle.db.insert(folders).values(
      Array.from({ length: 20 }, (_, i) => ({
        parentId: rootId,
        name: `report-${String(i).padStart(3, '0')}`,
      })),
    );

    const service = new SearchFoldersService(repo);
    const first = await service.exec({ query: 'report', cursor: null, limit: 8 });
    expect(first.items).toHaveLength(8);
    expect(first.items.map((f) => f.name)).toEqual([
      'report-000',
      'report-001',
      'report-002',
      'report-003',
      'report-004',
      'report-005',
      'report-006',
      'report-007',
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.exec({
      query: 'report',
      cursor: first.nextCursor,
      limit: 8,
    });
    expect(second.items.map((f) => f.name)).toEqual([
      'report-008',
      'report-009',
      'report-010',
      'report-011',
      'report-012',
      'report-013',
      'report-014',
      'report-015',
    ]);
  });

  it('filters out soft-deleted rows', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    await seedFixture(harness.handle, { depth: 0, width: 3, filesPerFolder: 0 });
    await harness.handle.db
      .update(folders)
      .set({ deletedAt: new Date() })
      .where(eq(folders.name, 'wide-0000'));

    const page = await repo.searchFolders({ query: 'wide', cursor: null, limit: 10 });
    expect(page.items.map((f) => f.name)).toEqual(['wide-0001', 'wide-0002']);
  });

  it('rejects queries shorter than the service minimum', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    const service = new SearchFoldersService(repo);
    await expect(
      service.exec({ query: 'a', cursor: null, limit: 10 }),
    ).rejects.toThrow(/at least 2 characters/);
  });
});

describe('DrizzleFolderRepository.restore', () => {
  it('undoes a subtree soft-delete in one transaction and returns counts', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    const softDelete = new SoftDeleteFolderService(repo, 10);
    const restore = new RestoreFolderService(repo, 10);

    await seedFixture(harness.handle, { depth: 0, width: 3, filesPerFolder: 2 });
    const wide0 = await harness.handle.db
      .select()
      .from(folders)
      .where(eq(folders.name, 'wide-0000'));
    const wideId = wide0[0]!.id;

    await softDelete.exec({ folderId: wideId });

    const deletedFiles = await harness.handle.db
      .select()
      .from(files)
      .where(and(eq(files.folderId, wideId)));
    expect(deletedFiles.every((f) => f.deletedAt !== null)).toBe(true);

    const result = await restore.exec({ folderId: wideId });
    expect(result.foldersRestored).toBe(1);
    expect(result.filesRestored).toBe(2);
    expect(result.priorDeletedAt).toBeInstanceOf(Date);

    const liveAgain = await harness.handle.db
      .select()
      .from(files)
      .where(and(eq(files.folderId, wideId), isNull(files.deletedAt)));
    expect(liveAgain).toHaveLength(2);
  });

  it('throws FolderNotFoundError for unknown ids', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    await expect(
      repo.restore({
        folderId: '00000000-0000-0000-0000-000000000000',
        restoredAt: new Date(),
        maxDepth: 10,
      }),
    ).rejects.toBeInstanceOf(FolderNotFoundError);
  });

  it('throws FolderNotDeletedError when the target is live', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 1,
      filesPerFolder: 0,
    });
    let caught: unknown;
    try {
      await repo.restore({ folderId: rootId, restoredAt: new Date(), maxDepth: 10 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FolderNotDeletedError);
  });

  it('does not disturb rows tombstoned in a different soft-delete event', async () => {
    if (!harness) return;
    const repo = new DrizzleFolderRepository(harness.handle, timing);
    const softDelete = new SoftDeleteFolderService(repo, 10);
    const restore = new RestoreFolderService(repo, 10);

    await seedFixture(harness.handle, { depth: 0, width: 1, filesPerFolder: 0 });
    const wide = await harness.handle.db
      .select()
      .from(folders)
      .where(eq(folders.name, 'wide-0000'));
    const wideId = wide[0]!.id;

    const earlier = new Date(Date.now() - 10 * 60 * 1000);
    await harness.handle.db.insert(files).values({
      folderId: wideId,
      name: 'pre.txt',
      deletedAt: earlier,
      updatedAt: earlier,
    });
    await harness.handle.db.insert(files).values({ folderId: wideId, name: 'ok.txt' });

    await softDelete.exec({ folderId: wideId });
    const result = await restore.exec({ folderId: wideId });
    // Only "ok.txt" (tombstoned by the subtree delete) restores; "pre.txt"
    // stays dead because it was deleted earlier, under a different timestamp.
    expect(result.filesRestored).toBe(1);
    const live = await harness.handle.db
      .select()
      .from(files)
      .where(and(eq(files.folderId, wideId), isNull(files.deletedAt)));
    expect(live.map((f) => f.name)).toEqual(['ok.txt']);
  });
});

describe('performance: trigram index usage', () => {
  it('installs the pg_trgm extension and folders_name_trgm_idx GIN index', async () => {
    if (!harness) return;
    // The migration we care about (`0001_pg_trgm_folders_name.sql`) does two
    // things; catalogue probes are deterministic regardless of row count /
    // planner stats, so they pin the migration outcome.
    const extRows = await harness.handle.db.execute<{ extname: string }>(sql`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `);
    expect(extRows).toHaveLength(1);

    const idxRows = await harness.handle.db.execute<{
      indexname: string;
      indexdef: string;
    }>(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'folders'
        AND indexname = 'folders_name_trgm_idx'
    `);
    expect(idxRows).toHaveLength(1);
    expect(idxRows[0]?.indexdef).toContain('USING gin');
    expect(idxRows[0]?.indexdef).toContain('gin_trgm_ops');
  });

  it('EXPLAIN ANALYZE confirms folders_name_trgm_idx is picked and executes under ceiling', async () => {
    if (!harness) return;
    // With seqscan disabled the planner MUST reach for an index — if the
    // trigram index is unusable for this predicate the plan would fall back
    // to a sort or blow up. Forcing the knob makes the test independent of
    // row-count thresholds that vary by Postgres version / stats.
    await seedFixture(harness.handle, { depth: 0, width: 0, filesPerFolder: 0 });
    const [root] = await harness.handle.db
      .select({ id: folders.id })
      .from(folders)
      .limit(1);
    const rootId = root!.id;
    await harness.handle.db.insert(folders).values(
      Array.from({ length: 500 }, (_, i) => ({
        parentId: rootId,
        name: `bulk-${String(i).padStart(4, '0')}-report`,
      })),
    );
    await harness.handle.db.execute(sql`ANALYZE folders`);

    // Run SET LOCAL + EXPLAIN ANALYZE inside the same transaction so the
    // planner knob actually applies. postgres.js would otherwise dispatch
    // these on (potentially) different connections or only return the first
    // result set.
    //
    // EXPLAIN ANALYZE (not bare EXPLAIN) executes the query and emits real
    // runtime timings — this is what Phase 3's test gate calls for: proof
    // the trigram path is not merely *eligible* but *fast* in practice.
    //
    // We isolate the name predicate (no deleted_at filter) so the planner's
    // only usable index for the ILIKE is the trigram GIN index — makes the
    // assertion deterministic regardless of how `deleted_at` selectivity
    // tips the plan in a non-isolated query.
    const plan = await harness.handle.withTransaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const rows = await tx.execute<{ 'QUERY PLAN': string }>(sql`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
        SELECT id FROM folders
        WHERE name ILIKE '%report%'
      `);
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });

    expect(plan).toContain('folders_name_trgm_idx');

    // EXPLAIN ANALYZE emits `Execution Time: <float> ms` on the last line.
    // We parse it and enforce a *generous* ceiling (150ms for 500 rows on a
    // local dev box). The goal isn't benchmarking — it's a regression trip
    // wire that fires if someone drops the index or writes an adversarial
    // query that collapses the trigram plan.
    const execMatch = plan.match(/Execution Time:\s*([\d.]+)\s*ms/);
    expect(execMatch).not.toBeNull();
    const executionMs = Number(execMatch![1]);
    expect(Number.isFinite(executionMs)).toBe(true);
    expect(executionMs).toBeLessThan(150);

    // Sanity: planner actually executed rows (not a zero-cost short circuit)
    // so the Execution Time above is meaningful.
    expect(plan).toMatch(/actual time=/);
  });
});
