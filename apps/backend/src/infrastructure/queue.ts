import IORedis, { type Redis } from 'ioredis';
import type { AppEnv } from '../env';

export const CLEANUP_QUEUE_NAME = 'smoothfs:cleanup';
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
