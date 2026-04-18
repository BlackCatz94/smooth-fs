import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { filesApi } from './files';

const ISO = '2024-01-01T00:00:00.000Z';
const U_FILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('filesApi', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('softDelete: DELETEs /api/v1/files/:id and returns void on 204', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const res = await filesApi.softDelete(U_FILE);
    expect(res).toBeUndefined();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/files/${U_FILE}`);
    expect(init.method).toBe('DELETE');
  });

  it('restore: POSTs /api/v1/files/:id/restore and parses the envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      ok({
        data: { id: U_FILE, priorDeletedAt: ISO },
        meta: { requestId: 'r' },
      }),
    );

    const res = await filesApi.restore(U_FILE);
    expect(res.data.id).toBe(U_FILE);
    expect(res.data.priorDeletedAt).toBe(ISO);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/api/v1/files/${U_FILE}/restore`);
    expect(init.method).toBe('POST');
  });

  it('forwards caller AbortSignal to the underlying fetch', async () => {
    const controller = new AbortController();
    controller.abort();

    fetchSpy.mockImplementationOnce((_url, init) => {
      expect((init as RequestInit).signal?.aborted).toBe(true);
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });

    await expect(
      filesApi.softDelete(U_FILE, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });
});
