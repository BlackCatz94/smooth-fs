/**
 * HTTP integration tests for Phase 3 `/api/v1/folders/*` endpoints.
 *
 * These exercise the full stack — Zod validation, application services,
 * Drizzle adapter, Postgres — against the test database. They skip
 * (not fail) when Postgres is unreachable so `bun test` stays green locally
 * without Docker. See `adapters/db/test-helpers.ts` for the isolation strategy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import {
  apiErrorBodySchema,
  folderContentsDataSchema,
  folderListDataSchema,
  folderRestoreDataSchema,
  folderSearchDataSchema,
  folderPathDataSchema,
} from '@smoothfs/shared';
import { buildApp } from '../../index';
import { buildContainer, type Container } from '../../infrastructure/container';
import { folders, files } from '../db/schema';
import { seedFixture } from '../db/seed';
import { tryBuildHarness, type TestHarness } from '../db/test-helpers';

type App = ReturnType<typeof buildApp>;

let harness: TestHarness | null = null;
let container: Container | null = null;
let app: App | null = null;

const base = 'http://localhost';

beforeAll(async () => {
  harness = await tryBuildHarness();
  if (!harness) return;
  container = buildContainer(harness.env);
  app = buildApp(container);
});

afterAll(async () => {
  if (container) {
    await container.shutdown();
  }
  if (harness) {
    await harness.close();
  }
});

beforeEach(async () => {
  if (!harness) return;
  await harness.reset();
});

async function hit(path: string, init?: RequestInit): Promise<Response> {
  if (!app) throw new Error('app unavailable');
  return app.handle(new Request(`${base}${path}`, init));
}

/**
 * Loose, test-only shape of the success envelope. We still `.parse()` the
 * `data` field through the real shared Zod schemas — this alias only exists
 * so TypeScript lets us read `json.data` / `json.meta` without cascading
 * `unknown` noise through every assertion.
 */
interface JsonEnvelope<TData = Record<string, unknown>> {
  data: TData;
  meta: {
    requestId: string;
    cursor?: string | null;
    hasMore?: boolean;
    debug?: Record<string, unknown>;
  };
}

async function readJson<TData = Record<string, unknown>>(res: Response): Promise<JsonEnvelope<TData>> {
  return (await res.json()) as JsonEnvelope<TData>;
}

describe('GET /api/v1/folders (root listing)', () => {
  it('returns only parentId=null folders with stable envelope and echoes request id', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, { depth: 0, width: 3, filesPerFolder: 0 });

    const res = await hit('/api/v1/folders?limit=10', {
      headers: { 'x-request-id': 'test-req-root' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('test-req-root');
    expect(res.headers.get('x-response-time-ms')).toMatch(/^\d+$/);

    const json = await readJson(res);
    const parsed = folderListDataSchema.parse(json.data);
    // Root fixture inserts exactly 1 parentId=null folder ("root").
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.parentId).toBeNull();
    expect(json.meta.requestId).toBe('test-req-root');
    expect(json.meta.debug?.endpointMs).toBeTypeOf('number');
  });

  it('400s on malformed cursor', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/folders?cursor=not-base64');
    expect(res.status).toBe(400);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('INVALID_CURSOR');
  });

  it('422s when limit exceeds max', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/folders?limit=9999');
    expect(res.status).toBe(422);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/folders/:id/children', () => {
  it('paginates with keyset cursor and respects `hasMore`', async () => {
    if (!harness) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 5,
      filesPerFolder: 0,
    });
    const first = await hit(`/api/v1/folders/${rootId}/children?limit=2`);
    expect(first.status).toBe(200);
    const firstJson = await readJson<{ items: { name: string }[] }>(first);
    expect(firstJson.data.items).toHaveLength(2);
    expect(firstJson.meta.hasMore).toBe(true);
    expect(firstJson.meta.cursor).toBeTypeOf('string');

    const cursor = firstJson.meta.cursor as string;
    const second = await hit(
      `/api/v1/folders/${rootId}/children?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    const secondJson = await readJson<{ items: { name: string }[] }>(second);
    expect(secondJson.data.items).toHaveLength(2);
    const firstNames = firstJson.data.items.map((f) => f.name);
    const secondNames = secondJson.data.items.map((f) => f.name);
    expect(new Set(firstNames).size + new Set(secondNames).size).toBe(4);
    // Cursors advance strictly; no overlap between pages.
    for (const n of secondNames) {
      expect(firstNames).not.toContain(n);
    }
  });

  it('returns empty page + no cursor when id has no children', async () => {
    if (!harness) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 0,
      filesPerFolder: 0,
    });
    const res = await hit(`/api/v1/folders/${rootId}/children`);
    const json = await readJson<{ items: unknown[] }>(res);
    expect(json.data.items).toEqual([]);
    expect(json.meta.cursor).toBeNull();
    expect(json.meta.hasMore).toBe(false);
  });

  it('422s when id is not a UUID', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/folders/not-a-uuid/children');
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/folders/:id/contents', () => {
  it('returns dual-cursor folders+files page', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, {
      depth: 0,
      width: 3,
      filesPerFolder: 0,
    });
    const wide0 = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'wide-0000'`);
    const wideId = wide0[0]!.id;
    await harness.handle.db.insert(files).values([
      { folderId: wideId, name: 'a.txt' },
      { folderId: wideId, name: 'b.txt' },
      { folderId: wideId, name: 'c.txt' },
    ]);

    const res = await hit(`/api/v1/folders/${wideId}/contents?limit=2`);
    expect(res.status).toBe(200);
    const json = await readJson(res);
    const parsed = folderContentsDataSchema.parse(json.data);
    expect(parsed.folders.items).toHaveLength(0);
    expect(parsed.files.items).toHaveLength(2);
    expect(parsed.files.hasMore).toBe(true);
    expect(parsed.files.nextCursor).toBeTypeOf('string');
    // Root-only content: the "contents" is the wide folder's own files; next
    // page via filesCursor returns the trailing row.
    const next = await hit(
      `/api/v1/folders/${wideId}/contents?limit=2&filesCursor=${encodeURIComponent(
        parsed.files.nextCursor!,
      )}`,
    );
    const nextJson = await readJson(next);
    const nextParsed = folderContentsDataSchema.parse(nextJson.data);
    expect(nextParsed.files.items).toHaveLength(1);
    expect(nextParsed.files.hasMore).toBe(false);
  });

  it('404s on unknown folder id', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/folders/00000000-0000-0000-0000-000000000000/contents');
    expect(res.status).toBe(404);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('FOLDER_NOT_FOUND');
  });
});

describe('GET /api/v1/folders/search', () => {
  it('substring-matches across the tree and paginates deterministically', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, { depth: 0, width: 6, filesPerFolder: 0 });

    const first = await hit('/api/v1/folders/search?q=wide&limit=3');
    expect(first.status).toBe(200);
    const firstJson = await readJson(first);
    const firstParsed = folderSearchDataSchema.parse(firstJson.data);
    expect(firstParsed.query).toBe('wide');
    expect(firstParsed.items).toHaveLength(3);
    expect(firstJson.meta.hasMore).toBe(true);

    const cursor = firstJson.meta.cursor as string;
    const second = await hit(
      `/api/v1/folders/search?q=wide&limit=3&cursor=${encodeURIComponent(cursor)}`,
    );
    const secondParsed = folderSearchDataSchema.parse((await readJson(second)).data);
    expect(secondParsed.items).toHaveLength(3);
    const overlap = firstParsed.items
      .map((f) => f.id)
      .filter((id) => secondParsed.items.some((s) => s.id === id));
    expect(overlap).toEqual([]);
  });

  it('hides soft-deleted rows', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, { depth: 0, width: 3, filesPerFolder: 0 });
    await harness.handle.db
      .update(folders)
      .set({ deletedAt: new Date() })
      .where(sql`${folders.name} = 'wide-0000'`);

    const res = await hit('/api/v1/folders/search?q=wide');
    const parsed = folderSearchDataSchema.parse((await readJson(res)).data);
    expect(parsed.items.map((f) => f.name).sort()).toEqual(['wide-0001', 'wide-0002']);
  });

  it('422s on too-short query', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/folders/search?q=a');
    expect(res.status).toBe(422);
  });

  it('escapes LIKE wildcards so `%` is treated as literal', async () => {
    if (!harness) return;
    const seed = await seedFixture(harness.handle, {
      depth: 0,
      width: 0,
      filesPerFolder: 0,
    });
    await harness.handle.db
      .insert(folders)
      .values([
        { parentId: seed.rootId, name: 'ab%cd' },
        { parentId: seed.rootId, name: 'abxxcd' },
      ]);
    // `%25c` decodes to the two-char literal `%c`, which clears the
    // min-length gate. If `%` leaked through unescaped, "abxxcd" would match
    // the wildcard + the letter c and slip into the result set.
    const res = await hit('/api/v1/folders/search?q=%25c');
    expect(res.status).toBe(200);
    const parsed = folderSearchDataSchema.parse((await readJson(res)).data);
    expect(parsed.items.map((f) => f.name)).toEqual(['ab%cd']);
  });
});

describe('DELETE /api/v1/folders/:id', () => {
  it('soft-deletes the subtree and returns 204 No Content', async () => {
    if (!harness) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 3,
      filesPerFolder: 2,
    });
    const wide0 = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'wide-0000'`);
    const wideId = wide0[0]!.id;

    const del = await hit(`/api/v1/folders/${wideId}`, {
      method: 'DELETE',
      headers: { 'x-request-id': 'test-req-delete' },
    });
    expect(del.status).toBe(204);
    expect(del.headers.get('x-request-id')).toBe('test-req-delete');
    // 204 must have an empty body per the spec.
    expect((await del.text()).length).toBe(0);

    // Deleted row is hidden from subsequent reads.
    const listRes = await hit(`/api/v1/folders/${rootId}/children`);
    const names = (
      await readJson<{ items: { name: string }[] }>(listRes)
    ).data.items.map((f) => f.name);
    expect(names).not.toContain('wide-0000');
  });

  it('restore after delete brings the subtree back', async () => {
    if (!harness) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 2,
      filesPerFolder: 1,
    });
    const wide0 = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'wide-0000'`);
    const wideId = wide0[0]!.id;

    const del = await hit(`/api/v1/folders/${wideId}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const restore = await hit(`/api/v1/folders/${wideId}/restore`, {
      method: 'POST',
    });
    expect(restore.status).toBe(200);
    const parsed = folderRestoreDataSchema.parse((await readJson(restore)).data);
    expect(parsed.foldersRestored).toBe(1);
    expect(parsed.filesRestored).toBe(1);

    const listAfter = await hit(`/api/v1/folders/${rootId}/children`);
    const namesAfter = (
      await readJson<{ items: { name: string }[] }>(listAfter)
    ).data.items.map((f) => f.name);
    expect(namesAfter).toContain('wide-0000');
  });

  it('404s when the folder does not exist', async () => {
    if (!harness) return;
    const res = await hit(
      '/api/v1/folders/00000000-0000-0000-0000-000000000000',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('FOLDER_NOT_FOUND');
  });

  it('422s when the id is not a UUID', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/folders/not-a-uuid', { method: 'DELETE' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/folders/:id/restore', () => {
  it('undoes a soft-delete event for the full subtree', async () => {
    if (!harness) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 3,
      filesPerFolder: 2,
    });
    const wide0 = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'wide-0000'`);
    const wideId = wide0[0]!.id;

    // Soft-delete via the API so we exercise the same cascade as production.
    const del = await hit(`/api/v1/folders/${wideId}/children`); // ensure visible
    expect(del.status).toBe(200);
    await container!.services.softDeleteFolder.exec({ folderId: wideId });

    const listDuringDelete = await hit(`/api/v1/folders/${rootId}/children`);
    const names = (
      await readJson<{ items: { name: string }[] }>(listDuringDelete)
    ).data.items.map((f) => f.name);
    expect(names).not.toContain('wide-0000');

    const restore = await hit(`/api/v1/folders/${wideId}/restore`, { method: 'POST' });
    expect(restore.status).toBe(200);
    const body = await readJson(restore);
    const parsed = folderRestoreDataSchema.parse(body.data);
    expect(parsed.id).toBe(wideId);
    expect(parsed.foldersRestored).toBe(1);
    expect(parsed.filesRestored).toBe(2);
    expect(parsed.priorDeletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const listAfter = await hit(`/api/v1/folders/${rootId}/children`);
    const namesAfter = (
      await readJson<{ items: { name: string }[] }>(listAfter)
    ).data.items.map((f) => f.name);
    expect(namesAfter).toContain('wide-0000');
  });

  it('409s when the folder is not soft-deleted', async () => {
    if (!harness) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 1,
      filesPerFolder: 0,
    });
    const res = await hit(`/api/v1/folders/${rootId}/restore`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('FOLDER_NOT_DELETED');
  });

  it('404s when the folder does not exist', async () => {
    if (!harness) return;
    const res = await hit(
      '/api/v1/folders/00000000-0000-0000-0000-000000000000/restore',
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
  });

  it('does NOT restore rows from earlier, unrelated soft-delete events', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, {
      depth: 0,
      width: 2,
      filesPerFolder: 0,
    });
    const wide0 = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'wide-0000'`);
    const wideId = wide0[0]!.id;

    // Event 1: pre-existing tombstone on a single file that predates the
    // subtree delete. It must stay tombstoned after restore.
    const earlier = new Date(Date.now() - 10 * 60 * 1000);
    await harness.handle.db.insert(files).values({
      folderId: wideId,
      name: 'prior.txt',
      deletedAt: earlier,
      updatedAt: earlier,
    });

    // Event 2: soft-delete the subtree (adds a live file then cascades).
    await harness.handle.db.insert(files).values({
      folderId: wideId,
      name: 'live.txt',
    });
    await container!.services.softDeleteFolder.exec({ folderId: wideId });

    const restore = await hit(`/api/v1/folders/${wideId}/restore`, { method: 'POST' });
    expect(restore.status).toBe(200);
    const parsed = folderRestoreDataSchema.parse((await readJson(restore)).data);
    // Only the event-2 file ("live.txt") is restored; "prior.txt" stays dead.
    expect(parsed.filesRestored).toBe(1);
    expect(parsed.foldersRestored).toBe(1);

    const remaining = await harness.handle.db
      .select()
      .from(files)
      .where(sql`${files.folderId} = ${wideId} AND ${files.deletedAt} IS NULL`);
    expect(remaining.map((r) => r.name)).toEqual(['live.txt']);
  });
});

describe('GET /api/v1/folders/:id/path', () => {
  it('returns path to root', async () => {
    if (!harness) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 2,
      width: 1,
      filesPerFolder: 0,
    });
    
    // Get leaf node
    const leaf = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'deep-0002'`);
    const leafId = leaf[0]!.id;

    const res = await hit(`/api/v1/folders/${leafId}/path`);
    expect(res.status).toBe(200);
    const json = await readJson(res);
    const parsed = folderPathDataSchema.parse(json.data);
    
    // Path should be root -> depth 1 -> leaf
    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0]?.id).toBe(rootId);
    expect(parsed.items[2]?.id).toBe(leafId);
  });

  it('404s on unknown folder id', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/folders/00000000-0000-0000-0000-000000000000/path');
    expect(res.status).toBe(404);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('FOLDER_NOT_FOUND');
  });
});

describe('CORS', () => {
  it('handles preflight OPTIONS request', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/folders', {
      method: 'OPTIONS',
      headers: {
        'Origin': harness.env.FRONTEND_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(harness.env.FRONTEND_ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });
});

describe('GET /health (regression: unchanged envelope)', () => {
  it('returns an ok envelope with a request id', async () => {
    if (!harness) return;
    const res = await hit('/health');
    expect(res.status).toBe(200);
    const json = await readJson<{ status: string }>(res);
    expect(json.data.status).toBe('ok');
    expect(json.meta.requestId).toBeTypeOf('string');
  });
});
