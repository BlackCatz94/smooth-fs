import { sql } from 'drizzle-orm';
import { loadEnv, resetEnvCache, type AppEnv } from '../../env';
import { createDbHandle, type DbHandle } from './db';

/**
 * Integration test strategy (documented per plan §8):
 *
 * - Requires an ephemeral Postgres provisioned by the repo's `docker-compose.yml`
 *   and a dedicated database (default: `smoothfs_test`).
 * - Migrations are applied by the dev workflow (`bun run db:migrate` with a
 *   test `DATABASE_URL`). Tests do NOT re-run migrations; they `TRUNCATE` the
 *   `folders` / `files` tables in a `beforeEach` hook to isolate cases.
 * - Tests that cannot reach Postgres are skipped (not failed) so `bun test` is
 *   green in environments without Docker; CI must provision DB before running.
 */
export interface TestHarness {
  readonly env: AppEnv;
  readonly handle: DbHandle;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function tryBuildHarness(): Promise<TestHarness | null> {
  resetEnvCache();
  process.env['NODE_ENV'] = 'test';
  process.env['DATABASE_URL'] ??=
    'postgres://postgres:postgres@localhost:5432/smoothfs_test';
  process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379';

  const env = loadEnv();
  const handle = createDbHandle(env);
  try {
    await handle.db.execute(sql`SELECT 1`);
  } catch (err) {
    console.info('integration-test DB unreachable, skipping', {
      url: env.DATABASE_URL,
      err: err instanceof Error ? err.message : String(err),
    });
    await handle.close();
    return null;
  }

  return {
    env,
    handle,
    async reset() {
      await handle.db.execute(
        sql`TRUNCATE TABLE files, folders RESTART IDENTITY CASCADE`,
      );
    },
    async close() {
      await handle.close();
    },
  };
}
