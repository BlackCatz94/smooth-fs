import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { InvalidEnvError, loadEnv } from '../../env';

const here = fileURLToPath(new URL('.', import.meta.url));

async function main(): Promise<void> {
  const env = loadEnv();
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: resolve(here, 'migrations') });
  await sql.end({ timeout: 5 });
  console.info('migrations applied');
}

main().catch((err) => {
  if (err instanceof InvalidEnvError) {
    console.error('Invalid environment configuration:');
    for (const [key, msgs] of Object.entries(err.fieldErrors)) {
      if (msgs && msgs.length > 0) console.error(`  ${key}: ${msgs.join('; ')}`);
    }
  } else {
    console.error('migration failed', err);
  }
  process.exit(1);
});
