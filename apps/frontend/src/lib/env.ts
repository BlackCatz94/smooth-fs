import { z } from 'zod';

const clientEnvSchema = z.object({
  VITE_API_BASE_URL: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().url().default('http://localhost:3000'),
  ),
});

export type FrontendEnv = z.infer<typeof clientEnvSchema>;

let cachedEnv: FrontendEnv | null = null;

/** Validates `import.meta.env` once at bootstrap; throws with Zod issues if misconfigured. */
export function loadEnv(): FrontendEnv {
  if (cachedEnv) return cachedEnv;
  cachedEnv = clientEnvSchema.parse({
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  });
  return cachedEnv;
}

export function getEnv(): FrontendEnv {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}
