import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';
import { createClient, ApiClientError } from './client';

const BASE = 'http://test.local';

function mockFetchOnce(init: { status: number; body: unknown; headers?: Record<string, string> }) {
  const res = new Response(JSON.stringify(init.body), {
    status: init.status,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(res);
}

describe('api client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses successful envelope into schema-validated payload', async () => {
    const schema = z.object({
      data: z.object({ items: z.array(z.object({ id: z.string() })) }),
      meta: z.object({ requestId: z.string() }),
    });
    mockFetchOnce({
      status: 200,
      body: { data: { items: [{ id: 'a' }] }, meta: { requestId: 'srv-req-1' } },
    });

    const client = createClient(BASE);
    const out = await client('/api/v1/folders', schema);
    expect(out.data.items[0]?.id).toBe('a');
  });

  it('sends x-request-id header on every request', async () => {
    const schema = z.any();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const client = createClient(BASE);
    await client('/any', schema);

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('x-request-id')).toBeTruthy();
  });

  it('normalizes HTTP error envelope into ApiClientError with requestId', async () => {
    mockFetchOnce({
      status: 404,
      body: {
        error: { code: 'NOT_FOUND', message: 'folder missing' },
        meta: { requestId: 'srv-req-2' },
      },
    });

    const client = createClient(BASE);
    await expect(client('/missing', z.any())).rejects.toMatchObject({
      name: 'ApiClientError',
      code: 'NOT_FOUND',
      status: 404,
      requestId: 'srv-req-2',
      message: 'folder missing',
    });
  });

  it('falls back to UNKNOWN_ERROR when error body is not a valid envelope', async () => {
    mockFetchOnce({ status: 500, body: { oops: true } });

    const client = createClient(BASE);
    const err = await client('/broken', z.any()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('UNKNOWN_ERROR');
    expect((err as ApiClientError).status).toBe(500);
  });

  it('surfaces SCHEMA_ERROR when response does not match schema', async () => {
    const schema = z.object({
      data: z.object({ must: z.string() }),
      meta: z.object({ requestId: z.string() }),
    });
    mockFetchOnce({
      status: 200,
      body: { data: { must: 123 }, meta: { requestId: 'r' } },
    });

    const client = createClient(BASE);
    const err = await client('/shape', schema).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('SCHEMA_ERROR');
  });

  it('maps network failure to NETWORK_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('failed to fetch'));

    const client = createClient(BASE);
    const err = await client('/net', z.any()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('NETWORK_ERROR');
    expect((err as ApiClientError).requestId).toBeTruthy();
  });
});
