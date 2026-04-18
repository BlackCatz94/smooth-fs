/**
 * HTTP integration tests for `DELETE /api/v1/files/:id`.
 *
 * Skips (not fails) when Postgres is unreachable so `bun test` stays green
 * without Docker. Uses the same harness pattern as the folders integration
 * tests so the shutdown/reset semantics match.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { apiErrorBodySchema, fileRestoreDataSchema } from '@smoothfs/shared';
import { buildApp } from '../../index';
import { buildContainer, type Container } from '../../infrastructure/container';
import { files, folders } from '../db/schema';
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
  if (container) await container.shutdown();
  if (harness) await harness.close();
});

beforeEach(async () => {
  if (!harness) return;
  await harness.reset();
});

async function hit(path: string, init?: RequestInit): Promise<Response> {
  if (!app) throw new Error('app unavailable');
  return app.handle(new Request(`${base}${path}`, init));
}

async function getFirstLiveFileId(): Promise<string> {
  if (!harness) throw new Error('harness unavailable');
  const rows = await harness.handle.db
    .select()
    .from(files)
    .where(sql`${files.deletedAt} IS NULL`)
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error('expected at least one live file from the fixture');
  return row.id;
}

describe('DELETE /api/v1/files/:id', () => {
  it('soft-deletes a file row and hides it from subsequent contents reads', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, { depth: 0, width: 1, filesPerFolder: 3 });
    const fileId = await getFirstLiveFileId();
    const folderRow = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'wide-0000'`);
    const folderId = folderRow[0]!.id;

    const del = await hit(`/api/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'x-request-id': 'test-req-file-delete' },
    });
    expect(del.status).toBe(204);
    expect(del.headers.get('x-request-id')).toBe('test-req-file-delete');
    expect((await del.text()).length).toBe(0);

    // The deleted file no longer appears in `getFolderContents`.
    const contents = await hit(`/api/v1/folders/${folderId}/contents`);
    expect(contents.status).toBe(200);
    const json = (await contents.json()) as {
      data: { files: { items: { id: string }[] } };
    };
    const remainingIds = json.data.files.items.map((f) => f.id);
    expect(remainingIds).not.toContain(fileId);
    // The other two files are still there — single-file delete must not
    // cascade to siblings.
    expect(remainingIds).toHaveLength(2);
  });

  it('is idempotent: repeated DELETE on a soft-deleted file 404s (presence check)', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, { depth: 0, width: 1, filesPerFolder: 1 });
    const fileId = await getFirstLiveFileId();

    const first = await hit(`/api/v1/files/${fileId}`, { method: 'DELETE' });
    expect(first.status).toBe(204);

    // Once tombstoned, `getById` returns null → service throws → 404.
    // This is intentional: the API treats "delete a row I already deleted"
    // as a client mistake worth surfacing rather than silently 204'ing.
    const second = await hit(`/api/v1/files/${fileId}`, { method: 'DELETE' });
    expect(second.status).toBe(404);
    const body = apiErrorBodySchema.parse(await second.json());
    expect(body.error.code).toBe('FILE_NOT_FOUND');
  });

  it('404s when the file does not exist', async () => {
    if (!harness) return;
    const res = await hit(
      '/api/v1/files/00000000-0000-0000-0000-000000000000',
      { method: 'DELETE' },
    );
    expect(res.status).toBe(404);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('FILE_NOT_FOUND');
  });

  it('422s when the id is not a UUID', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/files/not-a-uuid', { method: 'DELETE' });
    expect(res.status).toBe(422);
  });

  it('CORS preflight allows DELETE for the configured frontend origin', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/files/00000000-0000-0000-0000-000000000000', {
      method: 'OPTIONS',
      headers: {
        Origin: harness.env.FRONTEND_ORIGIN,
        'Access-Control-Request-Method': 'DELETE',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      harness.env.FRONTEND_ORIGIN,
    );
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
  });
});

describe('POST /api/v1/files/:id/restore', () => {
  it('undoes a single-file soft-delete and re-includes it in contents reads', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, { depth: 0, width: 1, filesPerFolder: 2 });
    const fileId = await getFirstLiveFileId();
    const folderRow = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'wide-0000'`);
    const folderId = folderRow[0]!.id;

    // Pre-flight: delete the file so we have something to restore.
    const del = await hit(`/api/v1/files/${fileId}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    // Confirm the row is gone from contents before we restore.
    const before = await hit(`/api/v1/folders/${folderId}/contents`);
    const beforeIds = ((await before.json()) as {
      data: { files: { items: { id: string }[] } };
    }).data.files.items.map((f) => f.id);
    expect(beforeIds).not.toContain(fileId);

    const restore = await hit(`/api/v1/files/${fileId}/restore`, {
      method: 'POST',
      headers: { 'x-request-id': 'test-req-file-restore' },
    });
    expect(restore.status).toBe(200);
    expect(restore.headers.get('x-request-id')).toBe('test-req-file-restore');

    const body = (await restore.json()) as { data: unknown; meta: unknown };
    const parsed = fileRestoreDataSchema.parse(body.data);
    expect(parsed.id).toBe(fileId);
    // priorDeletedAt is the timestamp the row carried before restore — the
    // adapter rounds to ms so this is a non-null ISO datetime string.
    expect(parsed.priorDeletedAt).not.toBeNull();
    expect(typeof parsed.priorDeletedAt).toBe('string');

    const after = await hit(`/api/v1/folders/${folderId}/contents`);
    const afterIds = ((await after.json()) as {
      data: { files: { items: { id: string }[] } };
    }).data.files.items.map((f) => f.id);
    expect(afterIds).toContain(fileId);
  });

  it('returns 409 FILE_NOT_DELETED when restoring a live file', async () => {
    if (!harness) return;
    await seedFixture(harness.handle, { depth: 0, width: 1, filesPerFolder: 1 });
    const fileId = await getFirstLiveFileId();

    const res = await hit(`/api/v1/files/${fileId}/restore`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('FILE_NOT_DELETED');
  });

  it('returns 404 when the file does not exist', async () => {
    if (!harness) return;
    const res = await hit(
      '/api/v1/files/00000000-0000-0000-0000-000000000000/restore',
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
    const body = apiErrorBodySchema.parse(await res.json());
    expect(body.error.code).toBe('FILE_NOT_FOUND');
  });

  it('returns 422 when the id is not a UUID', async () => {
    if (!harness) return;
    const res = await hit('/api/v1/files/not-a-uuid/restore', { method: 'POST' });
    expect(res.status).toBe(422);
  });

  it('CORS preflight allows POST for the configured frontend origin', async () => {
    if (!harness) return;
    const res = await hit(
      '/api/v1/files/00000000-0000-0000-0000-000000000000/restore',
      {
        method: 'OPTIONS',
        headers: {
          Origin: harness.env.FRONTEND_ORIGIN,
          'Access-Control-Request-Method': 'POST',
        },
      },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(
      harness.env.FRONTEND_ORIGIN,
    );
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
