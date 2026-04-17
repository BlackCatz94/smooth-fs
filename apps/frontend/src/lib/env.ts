import { z } from 'zod';

const clientEnvSchema = z.object({
  VITE_API_BASE_URL: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().url().default('http://localhost:3000'),
  ),
});

export type FrontendEnv = z.infer<typeof clientEnvSchema>;

/** Validates `import.meta.env` once at bootstrap; throws with Zod issues if misconfigured. */
export function loadEnv(): FrontendEnv {
  return clientEnvSchema.parse({
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  });
}
