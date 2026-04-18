import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { InvalidEnvError, loadEnv, resetEnvCache } from './env';

const ORIGINAL = { ...process.env };

describe('loadEnv', () => {
  beforeEach(() => {
    resetEnvCache();
    // Start from a clean slate every test so earlier mutations don't bleed.
    process.env = { ...ORIGINAL };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
    resetEnvCache();
  });

  it('throws InvalidEnvError (never process.exit) when DATABASE_URL is missing in production', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['DATABASE_URL'];
    delete process.env['REDIS_URL'];

    let caught: unknown;
    try {
      loadEnv();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(InvalidEnvError);
    const e = caught as InvalidEnvError;
    expect(e.message).toContain('Invalid environment configuration');
    expect(Object.keys(e.fieldErrors)).toContain('DATABASE_URL');
  });

  it('returns a parsed env when required values are present', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['DATABASE_URL'] = 'postgres://user:pass@localhost:5432/db';
    process.env['REDIS_URL'] = 'redis://127.0.0.1:6379';

    const env = loadEnv();
    expect(env.NODE_ENV).toBe('development');
    expect(env.DATABASE_URL).toBe('postgres://user:pass@localhost:5432/db');
  });

  it('exposes field-level issues for richer diagnostics', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['DATABASE_URL'];
    process.env['REDIS_URL'] = 'redis://127.0.0.1:6379';
    process.env['PORT'] = 'not-a-number';

    try {
      loadEnv();
      expect.unreachable('loadEnv should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidEnvError);
      const e = err as InvalidEnvError;
      // Both offending keys should be present so operators can fix them at once.
      const keys = Object.keys(e.fieldErrors);
      expect(keys).toContain('DATABASE_URL');
      expect(keys).toContain('PORT');
    }
  });
});
