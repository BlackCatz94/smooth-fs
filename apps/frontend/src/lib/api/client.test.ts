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

  it('surfaces TIMEOUT when the internal timer aborts the fetch', async () => {
    // Simulate a hung fetch that only settles when its own AbortSignal fires.
    // We don't plumb an external signal, so the abort originates from the
    // client's internal timeout — which is the TIMEOUT branch we want to hit.
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    const client = createClient(BASE);
    const err = await client('/slow', z.any(), { timeoutMs: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('TIMEOUT');
  });

  it('surfaces PARSE_ERROR when the response body is not valid JSON', async () => {
    const bad = new Response('not-json{', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(bad);

    const client = createClient(BASE);
    const err = await client('/corrupt', z.any()).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).code).toBe('PARSE_ERROR');
  });

  it('query values that are null or undefined are dropped from the URL', async () => {
    const schema = z.any();
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const client = createClient(BASE);
    await client('/q', schema, {
      method: 'GET',
      query: { limit: 10, cursor: null, after: undefined, flag: false },
    });

    const url = spy.mock.calls[0]?.[0] as string;
    expect(url).toContain('limit=10');
    expect(url).toContain('flag=false');
    expect(url).not.toContain('cursor');
    expect(url).not.toContain('after');
  });

  it('returns null for a 204 No Content response regardless of schema', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );
    const client = createClient(BASE);
    const out = await client('/deleted', null);
    expect(out).toBeNull();
  });
});
