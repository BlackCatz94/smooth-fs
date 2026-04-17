import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadEnv } from '../../env';

const env = loadEnv();
const here = fileURLToPath(new URL('.', import.meta.url));

async function main(): Promise<void> {
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: resolve(here, 'migrations') });
  await sql.end({ timeout: 5 });
  console.info('migrations applied');
}

main().catch((err) => {
  console.error('migration failed', err);
  process.exit(1);
});
