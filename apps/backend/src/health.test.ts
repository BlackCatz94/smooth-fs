import { describe, expect, test } from 'bun:test';
import { app } from './index';

describe('GET /health', () => {
  test('returns ApiEnvelope with ok status', async () => {
    const res = await app.handle(
      new Request('http://localhost/health', { method: 'GET' }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { status: string };
      meta: { requestId: string };
    };
    expect(json.data.status).toBe('ok');
    expect(typeof json.meta.requestId).toBe('string');
    expect(json.meta.requestId.length).toBeGreaterThan(0);
  });
});
