/**
 * HTTP integration tests for the Phase 3 Redis cache path.
 *
 * Why this file exists (vs the decorator unit test in
 * `folder-repository.caching.test.ts`):
 *
 *   - The unit test proves the decorator's *logic* against an in-memory fake
 *     cache. It does NOT prove that `buildContainer` actually swaps in the
 *     decorator when `ENABLE_CACHE=true`, that `RedisCache` correctly handles
 *     real SCAN/UNLINK + JSON round-trips, or that cache state persists across
 *     separate HTTP requests.
 *   - Phase 3's test gate pins "endpoint integration coverage for cache
 *     hit/miss + invalidation on writes" — that's what this file exercises.
 *
 * Test isolation:
 *   - Uses `CACHE_REDIS_DB=2` (BullMQ is on 0, dev cache on 1) so the suite
 *     never stomps the queue or a running dev instance.
 *   - Skips (does not fail) when Redis or Postgres is unreachable, same as
 *     the repository integration tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import IORedis from 'ioredis';
import { sql } from 'drizzle-orm';
import { buildApp } from '../../index';
import { buildContainer, type Container } from '../../infrastructure/container';
import { loadEnv, resetEnvCache, type AppEnv } from '../../env';
import { folders } from '../db/schema';
import { seedFixture } from '../db/seed';
import { tryBuildHarness, type TestHarness } from '../db/test-helpers';

type App = ReturnType<typeof buildApp>;

const base = 'http://localhost';
const CACHE_DB = 2;
const KEY_PREFIX = 'cache:folders:';

let harness: TestHarness | null = null;
let container: Container | null = null;
let app: App | null = null;
/** Separate client so assertions can read Redis without going through the container's cache. */
let inspector: IORedis | null = null;

async function probeRedis(url: string): Promise<boolean> {
  const probe = new IORedis(url, {
    db: CACHE_DB,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    try {
      probe.disconnect();
    } catch {
      // already disconnected
    }
    return false;
  }
}

function buildCachedEnv(base: AppEnv): AppEnv {
  // Phase 3 env schema forbids mutation; constructing a fresh object keeps
  // the type intact while flipping just the cache flags for this suite.
  return {
    ...base,
    ENABLE_CACHE: true,
    CACHE_REDIS_DB: CACHE_DB,
    CACHE_TTL_MS: 60_000,
  };
}

beforeAll(async () => {
  harness = await tryBuildHarness();
  if (!harness) return;

  const redisOk = await probeRedis(harness.env.REDIS_URL);
  if (!redisOk) {
    console.info('cache integration tests: Redis unreachable, skipping suite', {
      url: harness.env.REDIS_URL,
    });
    return;
  }

  // `tryBuildHarness` mutates process.env + caches; we need the container to
  // see `ENABLE_CACHE=true` without affecting sibling suites. Building the
  // AppEnv by composition (vs `loadEnv()`) avoids that coupling entirely.
  resetEnvCache();
  const envWithCache = buildCachedEnv(loadEnv());
  container = buildContainer(envWithCache);
  app = buildApp(container);

  inspector = new IORedis(envWithCache.REDIS_URL, {
    db: CACHE_DB,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  await inspector.connect();
  // Start clean: a stale key from a previous aborted run would silently
  // satisfy "cache exists" assertions without the current test populating it.
  await inspector.flushdb();
});

afterAll(async () => {
  if (inspector) {
    try {
      await inspector.flushdb();
      await inspector.quit();
    } catch {
      inspector.disconnect();
    }
  }
  if (container) {
    await container.shutdown();
  }
  if (harness) {
    await harness.close();
  }
});

beforeEach(async () => {
  if (!harness || !inspector) return;
  await harness.reset();
  // Wipe cache between tests so assertions on "keys after warm" start from 0.
  await inspector.flushdb();
});

async function hit(path: string, init?: RequestInit): Promise<Response> {
  if (!app) throw new Error('cache-enabled app unavailable');
  return app.handle(new Request(`${base}${path}`, init));
}

async function cacheKeys(): Promise<string[]> {
  if (!inspector) return [];
  return inspector.keys(`${KEY_PREFIX}*`);
}

describe('HTTP + RedisCache integration (ENABLE_CACHE=true)', () => {
  it('serves repeat reads from cache (stale-after-direct-mutation proof)', async () => {
    if (!harness || !app || !inspector) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 3,
      filesPerFolder: 0,
    });

    // 1st request populates the cache.
    const first = await hit(`/api/v1/folders/${rootId}/children?limit=10`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { data: { items: { name: string }[] } };
    const firstNames = firstBody.data.items.map((f) => f.name).sort();
    expect(firstNames).toHaveLength(3);

    const keysAfterWarm = await cacheKeys();
    expect(keysAfterWarm.length).toBeGreaterThan(0);

    // Mutate the DB *directly* (bypass the caching decorator + service layer)
    // so any non-cached read would observe 2 rows, not 3. If the 2nd HTTP
    // request still reports 3 rows, the cache is demonstrably serving the
    // response — no instrumentation needed.
    await harness.handle.db
      .update(folders)
      .set({ deletedAt: new Date() })
      .where(sql`${folders.name} = 'wide-0000'`);

    const second = await hit(`/api/v1/folders/${rootId}/children?limit=10`);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { data: { items: { name: string }[] } };
    const secondNames = secondBody.data.items.map((f) => f.name).sort();
    expect(secondNames).toEqual(firstNames);
    expect(secondNames).toContain('wide-0000');
  });

  it('invalidates the folder namespace on POST /restore (cache-wide sweep)', async () => {
    if (!harness || !app || !inspector || !container) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 3,
      filesPerFolder: 0,
    });
    const wide0 = await harness.handle.db
      .select()
      .from(folders)
      .where(sql`${folders.name} = 'wide-0000'`);
    const wideId = wide0[0]!.id;

    // Warm the root-children cache.
    const warm = await hit(`/api/v1/folders/${rootId}/children?limit=10`);
    expect(warm.status).toBe(200);
    expect(await cacheKeys()).not.toHaveLength(0);

    // Soft-delete via the service layer (no HTTP DELETE endpoint in Phase 3).
    // This still goes through `CachingFolderRepository.softDelete`, which
    // must sweep the `cache:folders:*` namespace.
    await container.services.softDeleteFolder.exec({ folderId: wideId });
    expect(await cacheKeys()).toHaveLength(0);

    // A fresh GET after invalidation must reflect the delete (not serve stale).
    const afterDelete = await hit(`/api/v1/folders/${rootId}/children?limit=10`);
    const afterDeleteBody = (await afterDelete.json()) as {
      data: { items: { name: string }[] };
    };
    expect(afterDeleteBody.data.items.map((f) => f.name)).not.toContain('wide-0000');
    // GET re-populates the cache (cache-aside on read).
    expect(await cacheKeys()).not.toHaveLength(0);

    // POST /restore through HTTP triggers a second invalidation sweep.
    const restore = await hit(`/api/v1/folders/${wideId}/restore`, { method: 'POST' });
    expect(restore.status).toBe(200);
    expect(await cacheKeys()).toHaveLength(0);

    const afterRestore = await hit(`/api/v1/folders/${rootId}/children?limit=10`);
    const afterRestoreBody = (await afterRestore.json()) as {
      data: { items: { name: string }[] };
    };
    expect(afterRestoreBody.data.items.map((f) => f.name)).toContain('wide-0000');
  });

  it('segments cache entries by query params (different limit = different key)', async () => {
    // Protects the key-derivation in CachingFolderRepository.listChildren
    // from silent regressions where different page sizes collapse onto one
    // cache entry (the Phase 3 plan pins keyset pagination correctness).
    if (!harness || !app || !inspector) return;
    const { rootId } = await seedFixture(harness.handle, {
      depth: 0,
      width: 5,
      filesPerFolder: 0,
    });

    await hit(`/api/v1/folders/${rootId}/children?limit=2`);
    const afterFirst = await cacheKeys();
    expect(afterFirst.length).toBeGreaterThan(0);

    await hit(`/api/v1/folders/${rootId}/children?limit=3`);
    const afterSecond = await cacheKeys();
    expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
  });
});
