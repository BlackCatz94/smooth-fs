import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import type { CleanupExpiredService } from '../application/cleanup-expired';
import type { AppEnv } from '../env';
import { forRequest, type AppLogger } from './logger';
import {
  CLEANUP_JOB_NAME,
  CLEANUP_QUEUE_NAME,
  assertRedisReachable,
  createRedisConnection,
} from './queue';

export interface CleanupWorkerHandle {
  readonly queue: Queue;
  readonly worker: Worker;
  readonly events: QueueEvents;
  close(): Promise<void>;
}

export interface StartCleanupWorkerDeps {
  readonly env: AppEnv;
  readonly logger: AppLogger;
  readonly cleanupExpired: CleanupExpiredService;
}

/**
 * Boots the BullMQ queue, worker, and events, and registers a repeatable job
 * using `env.CLEANUP_CRON`. Returns a handle so graceful shutdown can close
 * things in reverse order (worker → events → queue → redis).
 */
export async function startCleanupWorker(
  deps: StartCleanupWorkerDeps,
): Promise<CleanupWorkerHandle> {
  const { env, logger, cleanupExpired } = deps;

  const queueConnection = createRedisConnection(env);
  const workerConnection = createRedisConnection(env);
  const eventsConnection = createRedisConnection(env);
  await Promise.all([
    assertRedisReachable(queueConnection),
    assertRedisReachable(workerConnection),
    assertRedisReachable(eventsConnection),
  ]);

  const queue = new Queue(CLEANUP_QUEUE_NAME, { connection: queueConnection });
  const events = new QueueEvents(CLEANUP_QUEUE_NAME, {
    connection: eventsConnection,
  });

  await queue.upsertJobScheduler(
    `${CLEANUP_JOB_NAME}:scheduler`,
    { pattern: env.CLEANUP_CRON, immediately: false },
    {
      name: CLEANUP_JOB_NAME,
      data: {
        retentionDays: env.CLEANUP_RETENTION_DAYS,
        batchSize: env.CLEANUP_BATCH_SIZE,
      },
      opts: { removeOnComplete: 100, removeOnFail: 500 },
    },
  );

  const worker = new Worker(
    CLEANUP_QUEUE_NAME,
    async (job: Job<{ retentionDays: number; batchSize: number }>) => {
      const jobLog = forRequest(logger, `job:${job.id ?? 'unknown'}`);
      jobLog.info({ data: job.data }, 'cleanup job started');
      const result = await cleanupExpired.exec({
        retentionDays: job.data.retentionDays,
        batchSize: job.data.batchSize,
      });
      jobLog.info({ result }, 'cleanup job completed');
      return result;
    },
    {
      connection: workerConnection,
      concurrency: 1,
      autorun: true,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message, stack: err.stack },
      'cleanup job failed',
    );
  });
  events.on('completed', ({ jobId }) => {
    logger.debug({ jobId }, 'cleanup job event: completed');
  });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.warn({ jobId, failedReason }, 'cleanup job event: failed');
  });

  logger.info(
    {
      queue: CLEANUP_QUEUE_NAME,
      cron: env.CLEANUP_CRON,
      retentionDays: env.CLEANUP_RETENTION_DAYS,
      batchSize: env.CLEANUP_BATCH_SIZE,
    },
    'cleanup worker started',
  );

  return {
    queue,
    worker,
    events,
    async close(): Promise<void> {
      await worker.close();
      await events.close();
      await queue.close();
      queueConnection.disconnect();
      workerConnection.disconnect();
      eventsConnection.disconnect();
    },
  };
}
