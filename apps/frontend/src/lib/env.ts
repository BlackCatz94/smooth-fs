import { z } from 'zod';

const clientEnvSchema = z.object({
  VITE_API_BASE_URL: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().url().default('http://localhost:3000'),
  ),
  /**
   * Opt-in "public demo" mode. Enables a subtle banner reminding visitors
   * that the instance is a showcase (not production).
   *
   * Accepts "true"/"1"/"yes" as truthy — Vite compiles env vars as strings,
   * so a plain `z.boolean()` would reject the common "true" string form.
   */
  VITE_DEMO_MODE: z.preprocess(
    (val) => {
      if (typeof val !== 'string') return false;
      const v = val.trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes';
    },
    z.boolean().default(false),
  ),
});

export type FrontendEnv = z.infer<typeof clientEnvSchema>;

let cachedEnv: FrontendEnv | null = null;

/** Validates `import.meta.env` once at bootstrap; throws with Zod issues if misconfigured. */
export function loadEnv(): FrontendEnv {
  if (cachedEnv) return cachedEnv;
  cachedEnv = clientEnvSchema.parse({
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_DEMO_MODE: import.meta.env.VITE_DEMO_MODE,
  });
  return cachedEnv;
}

export function getEnv(): FrontendEnv {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}
