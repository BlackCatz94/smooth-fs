import type { Config } from 'drizzle-kit';

const url =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/smoothfs';

export default {
  schema: './src/adapters/db/schema.ts',
  out: './src/adapters/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config;
