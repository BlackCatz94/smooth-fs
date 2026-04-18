import IORedis, { type Redis } from 'ioredis';
import type { AppEnv } from '../env';

// BullMQ 5+ rejects queue names containing ':' — it uses ':' internally as the
// Redis key separator (e.g. `bull:<queue>:<jobId>`). Use a hyphen instead; the
// full Redis keys still end up namespaced as `bull:smoothfs-cleanup:*`, which
// is exactly what you want for isolation on a shared Redis instance.
export const CLEANUP_QUEUE_NAME = 'smoothfs-cleanup';
export const CLEANUP_JOB_NAME = 'soft-delete-cleanup';

/**
 * BullMQ requires the connection to have `maxRetriesPerRequest: null` so blocking
 * consumers don't surface as transient errors. See
 * https://docs.bullmq.io/guide/connections.
 */
export function createRedisConnection(env: AppEnv): Redis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

/** Ping Redis once so failures surface on boot rather than on first enqueue. */
export async function assertRedisReachable(redis: Redis): Promise<void> {
  const reply = await redis.ping();
  if (reply !== 'PONG') {
    throw new Error(`Redis PING returned unexpected reply: ${reply}`);
  }
}
