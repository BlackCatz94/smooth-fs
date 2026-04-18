import { apiEnvelopeSchema } from '@smoothfs/shared';
import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { mapError } from './adapters/http/error-mapper';
import { buildFolderRoutes } from './adapters/http/folders.routes';
import { resolveRequestId } from './adapters/http/helpers';
import { InvalidEnvError, loadEnv } from './env';
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
  /**
   * Redis health reflects the LONG-LIVED cache client maintained by the app.
   *   - `'ok'`      → cache is enabled and responded to PING
   *   - `'down'`    → cache is enabled but the probe failed; the app still
   *                   serves requests (cache is best-effort).
   *   - `'skipped'` → cache is disabled for this deployment.
   */
  redis: z.enum(['ok', 'down', 'skipped']),
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

      // Reuse the long-lived cache client rather than opening a fresh
      // IORedis per request. When `ENABLE_CACHE=false` the cache is a
      // NullCache that returns `'skipped'` — same semantics as before for
      // that deployment shape. The BullMQ worker's own Redis connection is
      // outside the web process's health concern; operators monitor it via
      // BullMQ's native dashboards instead of burning a connection here on
      // every probe.
      const redisStatus = await timed(
        'health.redis.ping',
        container.timing,
        () => container.cache.ping(),
      );

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
  let handle: AppHandle;
  try {
    handle = await startApp();
  } catch (err) {
    // Environment is the earliest and most common startup failure mode. We
    // keep the exit code (1) for config errors so operators / process
    // supervisors can distinguish "misconfigured" from "crashed at runtime".
    if (err instanceof InvalidEnvError) {
      console.error('Invalid environment configuration:');
      for (const [key, msgs] of Object.entries(err.fieldErrors)) {
        if (msgs && msgs.length > 0) {
          console.error(`  ${key}: ${msgs.join('; ')}`);
        }
      }
      process.exit(1);
    }
    console.error('Failed to start backend:', err);
    process.exit(1);
  }
  const gracefulShutdown = async (signal: string): Promise<void> => {
    handle.container.logger.info({ signal }, 'shutting down');
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
}
