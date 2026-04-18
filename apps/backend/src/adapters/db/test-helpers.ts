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
 *
 * **Safety invariant (do not relax):** the harness refuses to reset any DB
 * whose name does not contain `_test`. `bun test` auto-loads `.env` from the
 * CWD, and that `.env` typically points at the dev DB (`smoothfs`); without
 * this guard, `reset()` would `TRUNCATE` dev data. The guard runs before the
 * connection is even kept, so a misconfigured run is an immediate, loud
 * failure rather than a silent data loss.
 */
export interface TestHarness {
  readonly env: AppEnv;
  readonly handle: DbHandle;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_TEST_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5432/smoothfs_test';

/**
 * Extract the database name from a Postgres connection URL. Returns `null`
 * for malformed URLs so the caller can refuse to run rather than guessing.
 */
function parseDbName(url: string): string | null {
  try {
    const u = new URL(url);
    // `URL.pathname` starts with `/`; strip it and any query suffix that
    // `URL` already parsed out (so `/smoothfs_test` -> `smoothfs_test`).
    const name = u.pathname.replace(/^\//, '');
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function isTestDatabase(url: string): boolean {
  const name = parseDbName(url);
  // Conservative: `_test` as a substring so `smoothfs_test`, `app_test_ci`,
  // etc. all qualify; `smoothfs` (dev) does not. We want false negatives over
  // false positives — the failure mode of "your test DB was skipped" is a
  // noisy test run, while the failure mode of "your dev DB got truncated" is
  // hours of lost work.
  return name !== null && name.includes('_test');
}

export async function tryBuildHarness(): Promise<TestHarness | null> {
  resetEnvCache();
  process.env['NODE_ENV'] = 'test';

  // Force the test DB URL whenever the ambient value is missing OR points at
  // a non-test database. `??=` alone isn't enough: Bun auto-loads `.env` from
  // CWD, so `DATABASE_URL` usually arrives pre-populated with the dev DB.
  const ambient = process.env['DATABASE_URL'];
  if (!ambient || !isTestDatabase(ambient)) {
    if (ambient && !isTestDatabase(ambient)) {
      console.warn(
        `[test-harness] Overriding DATABASE_URL because it does not target a test database ` +
          `(got db="${parseDbName(ambient) ?? '<unparseable>'}"). ` +
          `Using ${DEFAULT_TEST_DATABASE_URL} instead.`,
      );
    }
    process.env['DATABASE_URL'] = DEFAULT_TEST_DATABASE_URL;
  }
  process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379';

  const env = loadEnv();

  // Defense-in-depth: even if someone bypasses the override above, refuse to
  // attach to a non-test DB so `reset()` can't truncate dev data.
  if (!isTestDatabase(env.DATABASE_URL)) {
    throw new Error(
      `[test-harness] Refusing to run: DATABASE_URL must target a database whose name ` +
        `contains "_test" (got "${parseDbName(env.DATABASE_URL) ?? '<unparseable>'}"). ` +
        `This guard exists because tests TRUNCATE the folders/files tables.`,
    );
  }

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
      // Third line of defense: re-check at the call site. Cheap (string op)
      // and guarantees the invariant holds even if a future refactor hands a
      // `TestHarness` back from some other construction path.
      if (!isTestDatabase(env.DATABASE_URL)) {
        throw new Error(
          `[test-harness] reset() refused: DATABASE_URL no longer targets a test DB.`,
        );
      }
      await handle.db.execute(
        sql`TRUNCATE TABLE files, folders RESTART IDENTITY CASCADE`,
      );
    },
    async close() {
      await handle.close();
    },
  };
}
