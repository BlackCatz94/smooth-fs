import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { foldersApi } from './folders';
import { LIST_MAX_LIMIT } from '@smoothfs/shared';

const ISO = '2024-01-01T00:00:00.000Z';

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function folderNode(id: string, parentId: string | null = null) {
  return {
    id,
    parentId,
    name: `F-${id.slice(0, 4)}`,
    createdAt: ISO,
    updatedAt: ISO,
    deletedAt: null,
    hasChildFolders: false,
  };
}

function fileNode(id: string, folderId: string) {
  return {
    id,
    folderId,
    name: `file-${id.slice(0, 4)}.txt`,
    createdAt: ISO,
    updatedAt: ISO,
    deletedAt: null,
  };
}

// RFC 4122 v4 UUIDs used in fixtures. Schemas validate `.uuid()` at parse
// time so plain strings won't do.
const U_ROOT = '11111111-1111-4111-8111-111111111111';
const U_A = '22222222-2222-4222-8222-222222222222';
const U_B = '33333333-3333-4333-8333-333333333333';

describe('foldersApi', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getRoot: GETs /api/v1/folders with pagination query params', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({
        data: { items: [folderNode(U_A), folderNode(U_B)] },
        meta: { requestId: 'srv-req-1' },
      }),
    );

    const res = await foldersApi.getRoot({ limit: 10, cursor: null });
    expect(res.data.items).toHaveLength(2);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/folders');
    expect(url).toContain('limit=10');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-request-id')).toBeTruthy();
  });

  it('getChildren: interpolates the folder id into the path', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({ data: { items: [folderNode(U_A, U_ROOT)] }, meta: { requestId: 'r' } }),
    );

    await foldersApi.getChildren(U_ROOT);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain(`/api/v1/folders/${U_ROOT}/children`);
  });

  it('getContents: returns dual-paginated folders + files with cursors', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({
        data: {
          folders: { items: [folderNode(U_A, U_ROOT)], nextCursor: 'fcur', hasMore: true },
          files: { items: [fileNode(U_A, U_ROOT)], nextCursor: null, hasMore: false },
        },
        meta: { requestId: 'r' },
      }),
    );

    const res = await foldersApi.getContents(U_ROOT, { limit: LIST_MAX_LIMIT });
    expect(res.data.folders.items).toHaveLength(1);
    expect(res.data.folders.hasMore).toBe(true);
    expect(res.data.files.nextCursor).toBeNull();
    expect(fetchSpy.mock.calls[0]?.[0]).toContain(`/api/v1/folders/${U_ROOT}/contents`);
  });

  it('search: encodes q into the query string', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({
        data: { items: [folderNode(U_A)], query: 'doc' },
        meta: { requestId: 'r' },
      }),
    );

    await foldersApi.search({ q: 'doc', limit: 25 });
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/v1/folders/search');
    expect(url).toContain('q=doc');
    expect(url).toContain('limit=25');
  });

  it('getPath: no query string and root-first items', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({
        data: { items: [folderNode(U_ROOT), folderNode(U_A, U_ROOT)] },
        meta: { requestId: 'r' },
      }),
    );

    const res = await foldersApi.getPath(U_A);
    expect(res.data.items[0]?.id).toBe(U_ROOT);
    expect(fetchSpy.mock.calls[0]?.[0]).toContain(`/api/v1/folders/${U_A}/path`);
    expect(fetchSpy.mock.calls[0]?.[0]).not.toContain('?');
  });

  it('restore: POSTs /api/v1/folders/:id/restore and returns the envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({
        data: {
          id: U_A,
          foldersRestored: 2,
          filesRestored: 5,
          priorDeletedAt: ISO,
        },
        meta: { requestId: 'r' },
      }),
    );

    const res = await foldersApi.restore(U_A);
    expect(res.data.foldersRestored).toBe(2);
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchSpy.mock.calls[0]?.[0]).toContain(`/api/v1/folders/${U_A}/restore`);
  });

  it('softDelete: DELETEs /api/v1/folders/:id and returns nothing on 204', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const res = await foldersApi.softDelete(U_A);
    expect(res).toBeUndefined();
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('DELETE');
    expect(fetchSpy.mock.calls[0]?.[0]).toContain(`/api/v1/folders/${U_A}`);
  });

  it('propagates caller-supplied AbortSignal so fetches can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    fetchSpy.mockImplementationOnce((_url, init) => {
      expect((init as RequestInit).signal?.aborted).toBe(true);
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });

    await expect(
      foldersApi.getChildren(U_ROOT, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });
});
