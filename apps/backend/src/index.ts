import { randomUUID } from 'node:crypto';
import { apiEnvelopeSchema } from '@smoothfs/shared';
import { Elysia } from 'elysia';
import IORedis from 'ioredis';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { mapError } from './adapters/http/error-mapper';
import { loadEnv } from './env';
import {
  startCleanupWorker,
  type CleanupWorkerHandle,
} from './infrastructure/cleanup-worker';
import { buildContainer, type Container } from './infrastructure/container';
import { forRequest } from './infrastructure/logger';
import { timed } from './infrastructure/timing';

const healthData = z.object({
  status: z.literal('ok'),
  db: z.literal('ok'),
  redis: z.enum(['ok', 'skipped']),
});
const healthEnvelope = apiEnvelopeSchema(healthData);

function resolveRequestId(req: Request): string {
  const headerId = req.headers.get('x-request-id')?.trim();
  return headerId !== undefined && headerId.length > 0 ? headerId : randomUUID();
}

export type App = ReturnType<typeof buildApp>;

export interface AppHandle {
  readonly app: App;
  readonly container: Container;
  readonly worker: CleanupWorkerHandle | null;
  close(): Promise<void>;
}

export function buildApp(container: Container) {
  const { env, logger } = container;

  return new Elysia()
    .onError(({ error, request, set }) => {
      const requestId = resolveRequestId(request);
      const mapped = mapError(error, requestId);
      set.status = mapped.status;
      set.headers['x-request-id'] = requestId;
      forRequest(logger, requestId).error(
        {
          err: mapped.body.error,
          status: mapped.status,
          path: new URL(request.url).pathname,
        },
        'request failed',
      );
      return mapped.body;
    })
    .get('/health', async ({ request, set }) => {
      const requestId = resolveRequestId(request);
      set.headers['x-request-id'] = requestId;

      await timed('health.db.ping', container.timing, async () => {
        await container.dbHandle.db.execute(sql`SELECT 1`);
      });

      let redisStatus: 'ok' | 'skipped' = 'skipped';
      if (env.ENABLE_CLEANUP_WORKER) {
        const probe = new IORedis(env.REDIS_URL, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          enableReadyCheck: false,
        });
        try {
          await probe.connect();
          const pong = await probe.ping();
          redisStatus = pong === 'PONG' ? 'ok' : 'skipped';
        } finally {
          probe.disconnect();
        }
      }

      return healthEnvelope.parse({
        data: { status: 'ok' as const, db: 'ok' as const, redis: redisStatus },
        meta: { requestId },
      });
    });
}

export async function startApp(): Promise<AppHandle> {
  const env = loadEnv();
  const container = buildContainer(env);
  const { logger } = container;

  const worker = env.ENABLE_CLEANUP_WORKER
    ? await startCleanupWorker({
        env,
        logger,
        cleanupExpired: container.services.cleanupExpired,
      })
    : null;

  const app = buildApp(container);
  app.listen({ port: env.PORT, hostname: '0.0.0.0' });
  logger.info({ port: env.PORT }, 'smoothfs backend listening');

  let closed = false;
  return {
    app,
    container,
    worker,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await app.stop();
      if (worker) {
        await worker.close();
      }
      await container.shutdown();
    },
  };
}

if (import.meta.main) {
  const handle = await startApp();
  const gracefulShutdown = async (signal: string): Promise<void> => {
    handle.container.logger.info({ signal }, 'shutting down');
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
}
