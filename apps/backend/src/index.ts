import { apiEnvelopeSchema } from '@smoothfs/shared';
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import IORedis from 'ioredis';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { mapError } from './adapters/http/error-mapper';
import { buildFolderRoutes } from './adapters/http/folders.routes';
import { resolveRequestId } from './adapters/http/helpers';
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

export type App = ReturnType<typeof buildApp>;

export interface AppHandle {
  readonly app: App;
  readonly container: Container;
  readonly worker: CleanupWorkerHandle | null;
  close(): Promise<void>;
}

export function buildApp(container: Container) {
  const { env, logger } = container;

  // Per-request start times. WeakMap keeps entries tied to the Request object
  // lifetime (no manual cleanup); works across `.use()` subrouters where
  // Elysia's `.derive()` propagation is implementation-defined.
  const starts = new WeakMap<Request, number>();
  const elapsedMs = (req: Request): number => {
    const start = starts.get(req);
    return start === undefined ? 0 : Math.round(performance.now() - start);
  };

  return new Elysia()
    .use(
      cors({
        origin: env.FRONTEND_ORIGIN,
        methods: ['GET', 'POST', 'OPTIONS'],
        exposeHeaders: ['x-request-id', 'x-response-time-ms'],
      }),
    )
    .onRequest(({ request }) => {
      starts.set(request, performance.now());
    })
    .onAfterHandle(({ request, set }) => {
      const ms = elapsedMs(request);
      set.headers['x-response-time-ms'] = String(ms);
      if (ms >= env.HTTP_SLOW_REQUEST_MS) {
        const requestId = resolveRequestId(request);
        forRequest(logger, requestId).warn(
          { path: new URL(request.url).pathname, ms },
          'slow http request',
        );
      }
    })
    .onError(({ error, request, set }) => {
      const requestId = resolveRequestId(request);
      const mapped = mapError(error, requestId);
      const ms = elapsedMs(request);
      set.status = mapped.status;
      set.headers['x-request-id'] = requestId;
      set.headers['x-response-time-ms'] = String(ms);
      forRequest(logger, requestId).error(
        {
          err: mapped.body.error,
          status: mapped.status,
          path: new URL(request.url).pathname,
          ms,
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

      // Probe Redis only when something in this process actually depends on it
      // (cleanup worker and/or the cache). Otherwise `/health` stays DB-only.
      let redisStatus: 'ok' | 'skipped' = 'skipped';
      if (env.ENABLE_CLEANUP_WORKER || env.ENABLE_CACHE) {
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
    })
    .use(buildFolderRoutes(container));
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
