import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (e.g. postgres://user:pass@host:5432/db)'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (e.g. redis://127.0.0.1:6379)'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

function firstLine(
  value: string | undefined,
  fallback: string | undefined,
): string | undefined {
  if (value === undefined) {
    return fallback;
  }
  const t = value.trim();
  if (t.length === 0) {
    return fallback;
  }
  return t;
}

/**
 * Parse and cache process environment. Exits the process on the first invalid config
 * (non-test) with a Zod error shape (no silent failure).
 */
export function loadEnv(): AppEnv {
  if (cached) {
    return cached;
  }
  const isTest = (process.env['NODE_ENV'] ?? '') === 'test';
  const raw = {
    NODE_ENV: (() => {
      const n = process.env['NODE_ENV'];
      if (n === 'development' || n === 'test' || n === 'production') {
        return n;
      }
      return isTest ? 'test' : 'development';
    })(),
    PORT: process.env['PORT'],
    LOG_LEVEL:
      process.env['LOG_LEVEL'] !== undefined && process.env['LOG_LEVEL'].trim() !== ''
        ? process.env['LOG_LEVEL']
        : undefined,
    DATABASE_URL: firstLine(
      process.env['DATABASE_URL'],
      isTest ? 'postgres://localhost/test' : undefined,
    ),
    REDIS_URL: firstLine(
      process.env['REDIS_URL'],
      isTest ? 'redis://127.0.0.1:6379' : undefined,
    ),
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
