import type { AppLogger } from './logger';

export interface TimingConfig {
  readonly logger: AppLogger;
  /** DB operations slower than this emit a `warn` log with elapsed ms. */
  readonly slowQueryMs: number;
}

/**
 * Run `fn` and log its duration. Emits `debug` under threshold, `warn` over.
 * Used to instrument every repository method so slow queries surface without
 * needing to run `EXPLAIN ANALYZE` manually (plan §6).
 */
export async function timed<T>(
  op: string,
  cfg: TimingConfig,
  fn: () => Promise<T>,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const elapsedMs = Math.round(performance.now() - start);
    const payload = { op, elapsedMs, ...extra };
    if (elapsedMs >= cfg.slowQueryMs) {
      cfg.logger.warn(payload, 'slow db operation');
    } else {
      cfg.logger.debug(payload, 'db operation');
    }
    return result;
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - start);
    cfg.logger.error(
      {
        op,
        elapsedMs,
        err: err instanceof Error ? err.message : String(err),
        ...extra,
      },
      'db operation failed',
    );
    throw err;
  }
}
