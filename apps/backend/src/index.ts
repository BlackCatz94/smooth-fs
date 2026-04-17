import { randomUUID } from 'node:crypto';
import { Elysia } from 'elysia';
import { apiEnvelopeSchema } from '@smoothfs/shared';
import { z } from 'zod';
import { loadEnv } from './env';

const env = loadEnv();
const healthData = z.object({ status: z.literal('ok') });
const healthResponse = apiEnvelopeSchema(healthData);

export const app = new Elysia().get('/health', ({ request }) => {
  const headerId = request.headers.get('x-request-id')?.trim();
  const requestId =
    headerId !== undefined && headerId.length > 0 ? headerId : randomUUID();
  const body = {
    data: { status: 'ok' as const },
    meta: { requestId },
  };
  return healthResponse.parse(body);
});

if (import.meta.main) {
  app.listen({ port: env.PORT, hostname: '0.0.0.0' });
  console.info(`smooth-fs backend listening on port ${env.PORT}`);
}
