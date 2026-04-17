import { describe, expect, test } from 'vitest';
import { apiEnvelopeSchema } from '@smoothfs/shared';
import { z } from 'zod';

describe('@smoothfs/shared via frontend bundle', () => {
  test('apiEnvelopeSchema parses minimal payload', () => {
    const schema = apiEnvelopeSchema(z.object({ ping: z.literal(true) }));
    const parsed = schema.parse({
      data: { ping: true },
      meta: { requestId: 'req-fe-1' },
    });
    expect(parsed.meta.requestId).toBe('req-fe-1');
    expect(parsed.data.ping).toBe(true);
  });
});
