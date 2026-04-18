/**
 * One-shot bootstrap: apply migrations, then (re)seed the demo fixture.
 *
 * Why a dedicated script instead of chaining `db:migrate && db:seed` from a
 * Railway pre-deploy field:
 *   - Railway's service UI input for `preDeployCommand` is a single-line
 *     field and can silently truncate long commands.
 *   - `&&` is interpreted by the container's shell, which on some Railway
 *     builder versions is `ash` (busybox), where quoting around `--filter
 *     @smoothfs/backend` can bite you in subtle ways.
 *   - A single `bun run` command with an explicit script name removes all
 *     of that ambiguity, and gives us a single place to log progress +
 *     fail fast with a clean exit code.
 *
 * Exit codes mirror the individual scripts: 1 for invalid env or any step
 * failure. Operators should see either:
 *   [bootstrap] migrations applied
 *   [bootstrap] seed complete { rootId, totalFolders, totalFiles }
 * or a precise error identifying which phase failed.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { InvalidEnvError, loadEnv, resetEnvCache } from '../../env';
import { createDbHandle } from './db';
import { seedFixture } from './seed';

const here = fileURLToPath(new URL('.', import.meta.url));

async function runMigrations(databaseUrl: string): Promise<void> {
  // Use a dedicated short-lived connection for migrations; it speaks plain
  // SQL and must NOT go through the pooled DbHandle (which would fight
  // Drizzle's migrator on the same client).
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: resolve(here, 'migrations') });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  resetEnvCache();
  const env = loadEnv();

  console.info('[bootstrap] applying migrations');
  await runMigrations(env.DATABASE_URL);
  console.info('[bootstrap] migrations applied');

  const handle = createDbHandle(env);
  try {
    console.info('[bootstrap] seeding fixture');
    const result = await seedFixture(handle, {
      depth: 32,
      width: 64,
      filesPerFolder: 8,
    });
    console.info('[bootstrap] seed complete', result);
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  if (err instanceof InvalidEnvError) {
    console.error('[bootstrap] invalid environment configuration:');
    for (const [key, msgs] of Object.entries(err.fieldErrors)) {
      if (msgs && msgs.length > 0) console.error(`  ${key}: ${msgs.join('; ')}`);
    }
  } else {
    console.error('[bootstrap] failed', err);
  }
  process.exit(1);
});
