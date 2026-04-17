import { describe, expect, test } from 'bun:test';
import { apiEnvelopeSchema } from './dto/envelope';
import { z } from 'zod';

describe('apiEnvelopeSchema', () => {
  test('parses valid health-like payload', () => {
    const schema = apiEnvelopeSchema(z.object({ status: z.literal('ok') }));
    const out = schema.parse({
      data: { status: 'ok' },
      meta: { requestId: 'req-1' },
    });
    expect(out.data.status).toBe('ok');
    expect(out.meta.requestId).toBe('req-1');
  });
});
