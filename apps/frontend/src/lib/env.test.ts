import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `loadEnv` caches the parsed env on first call, so each test resets the
 * module registry (`vi.resetModules()`) before importing so the module-level
 * cache is fresh, then stubs `import.meta.env` via `vi.stubEnv`.
 */
async function reloadModule() {
  vi.resetModules();
  return import('./env');
}

describe('frontend env loader', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses VITE_API_BASE_URL as a valid URL and caches the result', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com');
    const { loadEnv, getEnv } = await reloadModule();
    const first = loadEnv();
    expect(first.VITE_API_BASE_URL).toBe('https://api.example.com');
    // Second call returns the same cached instance (getEnv short-circuits).
    expect(getEnv()).toBe(first);
  });

  it('falls back to the default when the var is an empty string', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    const { loadEnv } = await reloadModule();
    expect(loadEnv().VITE_API_BASE_URL).toBe('http://localhost:3000');
  });

  it('throws when the URL is malformed', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'not a url');
    const { loadEnv } = await reloadModule();
    expect(() => loadEnv()).toThrow();
  });
});
