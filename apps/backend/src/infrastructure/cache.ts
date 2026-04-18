import IORedis, { type Redis } from 'ioredis';
import type { AppEnv } from '../env';
import type { AppLogger } from './logger';

/**
 * Cache port used by the folder repository decorator. Implementations MUST
 * treat errors as cache misses (return `null` from `get`, swallow-and-log on
 * `set`/`invalidatePattern`) so a Redis hiccup degrades to a DB hit instead of
 * failing the request.
 */
/**
 * Result of `Cache.ping()`. Kept deliberately narrow so consumers (notably
 * `/health`) can surface each state without string-parsing:
 *   - `'ok'`      — Redis responded with PONG within the request deadline.
 *   - `'down'`    — cache is enabled but the probe failed (timeout, auth,
 *                   network). The caller should NOT fail health-check; it's
 *                   a degraded-but-serving signal.
 *   - `'skipped'` — cache is disabled; nothing to probe.
 */
export type CachePingResult = 'ok' | 'down' | 'skipped';

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  /**
   * Deletes every key matching `pattern` using SCAN + UNLINK (non-blocking).
   * Returns the number of keys deleted for observability.
   */
  invalidatePattern(pattern: string): Promise<number>;
  /**
   * Liveness probe. Must reuse the long-lived client (never open a new
   * connection per call). Designed for the `/health` endpoint so that a
   * naive probe doesn't create a connection-churn hotspot under load.
   */
  ping(): Promise<CachePingResult>;
  close(): Promise<void>;
}

/** No-op cache used when `ENABLE_CACHE=false` so callers don't need branches. */
export class NullCache implements Cache {
  async get<T>(_key: string): Promise<T | null> {
    return null;
  }
  async set<T>(_key: string, _value: T, _ttlMs: number): Promise<void> {
    return;
  }
  async invalidatePattern(_pattern: string): Promise<number> {
    return 0;
  }
  async ping(): Promise<CachePingResult> {
    return 'skipped';
  }
  async close(): Promise<void> {
    return;
  }
}

export interface RedisCacheOptions {
  readonly url: string;
  readonly db: number;
  readonly logger: AppLogger;
}

/**
 * Redis-backed cache. SCAN-based invalidation avoids the `KEYS` pitfall; UNLINK
 * (vs DEL) hands the reclaim work to a background thread so large eviction
 * sweeps don't stall the Redis main loop.
 */
export class RedisCache implements Cache {
  private readonly client: Redis;
  private readonly log: AppLogger;

  constructor(opts: RedisCacheOptions) {
    this.log = opts.logger;
    this.client = new IORedis(opts.url, {
      db: opts.db,
      // Cache ops should fail fast — a slow Redis must not hold up a web req.
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    this.client.on('error', (err) => {
      // Don't re-throw; the cache is best-effort. Errors are logged once per
      // connection event, not per request.
      this.log.warn({ err: err.message }, 'redis cache error');
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      await this.ensureConnected();
      const raw = await this.client.get(key);
      if (raw === null) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'cache get failed; treating as miss',
      );
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      await this.ensureConnected();
      const payload = JSON.stringify(value);
      await this.client.set(key, payload, 'PX', ttlMs);
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), key },
        'cache set failed; ignoring',
      );
    }
  }

  async invalidatePattern(pattern: string): Promise<number> {
    try {
      await this.ensureConnected();
      let cursor = '0';
      let removed = 0;
      // SCAN iterates; count is a hint (not a hard cap). Keep it small so we
      // never block on a giant single reply from the server.
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length > 0) {
          // UNLINK is async server-side; behaves like DEL from the client's POV.
          const n = await this.client.unlink(...keys);
          removed += n;
        }
      } while (cursor !== '0');
      return removed;
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), pattern },
        'cache invalidation failed',
      );
      return 0;
    }
  }

  async ping(): Promise<CachePingResult> {
    try {
      await this.ensureConnected();
      const pong = await this.client.ping();
      return pong === 'PONG' ? 'ok' : 'down';
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'cache ping failed',
      );
      return 'down';
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // quit() throws if we never connected; disconnect is safe fallback.
      this.client.disconnect();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status === 'ready' || this.client.status === 'connecting') {
      return;
    }
    if (this.client.status === 'wait' || this.client.status === 'end') {
      await this.client.connect();
    }
  }
}

/**
 * Factory: returns a live Redis cache when enabled, otherwise a no-op.
 * Centralising the decision keeps the container wiring deterministic.
 */
export function createCache(env: AppEnv, logger: AppLogger): Cache {
  if (!env.ENABLE_CACHE) {
    return new NullCache();
  }
  return new RedisCache({ url: env.REDIS_URL, db: env.CACHE_REDIS_DB, logger });
}
