import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (e.g. postgres://user:pass@host:5432/db)'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(300_000).default(5_000),
  /** DB operations slower than this threshold are logged at `warn` level. */
  DB_SLOW_QUERY_MS: z.coerce.number().int().min(1).max(60_000).default(200),
  /** HTTP requests slower than this threshold emit a `warn` with path + ms. */
  HTTP_SLOW_REQUEST_MS: z.coerce.number().int().min(1).max(60_000).default(500),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required (e.g. redis://127.0.0.1:6379)'),

  MAX_TREE_DEPTH: z.coerce.number().int().min(1).max(1024).default(64),

  ENABLE_CLEANUP_WORKER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CLEANUP_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(30),
  CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(100_000).default(500),
  /** Standard 5-field cron expression; BullMQ's repeat.pattern */
  CLEANUP_CRON: z.string().min(1).default('0 3 * * *'),

  /**
   * Phase 3 Redis cache. Defaults to OFF so integration tests and local dev
   * don't accidentally depend on a live Redis; enable explicitly in staging/prod.
   * Uses a separate logical DB from the BullMQ queue to isolate blast radius.
   */
  ENABLE_CACHE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CACHE_REDIS_DB: z.coerce.number().int().min(0).max(15).default(1),
  CACHE_TTL_MS: z.coerce.number().int().min(100).max(24 * 60 * 60 * 1000).default(60_000),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

function pickString(
  key: string,
  fallback: string | undefined = undefined,
): string | undefined {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

/**
 * Parse and cache process environment. Exits the process on the first invalid config
 * (non-test) with a Zod error shape (no silent failure).
 */
export function loadEnv(): AppEnv {
  if (cached) {
    return cached;
  }
  const nodeEnvRaw = process.env['NODE_ENV'];
  const isTest = nodeEnvRaw === 'test';
  const nodeEnv: 'development' | 'test' | 'production' =
    nodeEnvRaw === 'development' || nodeEnvRaw === 'test' || nodeEnvRaw === 'production'
      ? nodeEnvRaw
      : 'development';

  const raw = {
    NODE_ENV: nodeEnv,
    PORT: pickString('PORT'),
    LOG_LEVEL: pickString('LOG_LEVEL'),
    DATABASE_URL: pickString(
      'DATABASE_URL',
      isTest ? 'postgres://postgres:postgres@localhost:5432/smoothfs_test' : undefined,
    ),
    DB_POOL_MAX: pickString('DB_POOL_MAX'),
    DB_STATEMENT_TIMEOUT_MS: pickString('DB_STATEMENT_TIMEOUT_MS'),
    DB_SLOW_QUERY_MS: pickString('DB_SLOW_QUERY_MS'),
    HTTP_SLOW_REQUEST_MS: pickString('HTTP_SLOW_REQUEST_MS'),
    REDIS_URL: pickString('REDIS_URL', isTest ? 'redis://127.0.0.1:6379' : undefined),
    MAX_TREE_DEPTH: pickString('MAX_TREE_DEPTH'),
    ENABLE_CLEANUP_WORKER: pickString('ENABLE_CLEANUP_WORKER'),
    CLEANUP_RETENTION_DAYS: pickString('CLEANUP_RETENTION_DAYS'),
    CLEANUP_BATCH_SIZE: pickString('CLEANUP_BATCH_SIZE'),
    CLEANUP_CRON: pickString('CLEANUP_CRON'),
    ENABLE_CACHE: pickString('ENABLE_CACHE'),
    CACHE_REDIS_DB: pickString('CACHE_REDIS_DB'),
    CACHE_TTL_MS: pickString('CACHE_TTL_MS'),
  };

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.flatten().fieldErrors);
    console.error(result.error.issues);
    process.exit(1);
  }
  cached = result.data;
  return cached;
}

/** Test helper: force re-parse next call. Not used in production paths. */
export function resetEnvCache(): void {
  cached = null;
}
