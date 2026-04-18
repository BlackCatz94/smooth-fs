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

  it('VITE_DEMO_MODE defaults to false when unset', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');
    const { loadEnv } = await reloadModule();
    expect(loadEnv().VITE_DEMO_MODE).toBe(false);
  });

  it('VITE_DEMO_MODE coerces "true"/"1"/"yes" to true (case-insensitive)', async () => {
    for (const truthy of ['true', 'True', '1', 'yes', 'YES']) {
      vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');
      vi.stubEnv('VITE_DEMO_MODE', truthy);
      const { loadEnv } = await reloadModule();
      expect(loadEnv().VITE_DEMO_MODE).toBe(true);
    }
  });

  it('VITE_DEMO_MODE treats any other string as false rather than rejecting', async () => {
    // We prefer "unexpected value → safe default" over throwing here: the
    // banner is cosmetic, and an accidental `VITE_DEMO_MODE=somethingelse`
    // shouldn't brick the whole frontend boot.
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000');
    vi.stubEnv('VITE_DEMO_MODE', 'definitely not truthy');
    const { loadEnv } = await reloadModule();
    expect(loadEnv().VITE_DEMO_MODE).toBe(false);
  });
});
