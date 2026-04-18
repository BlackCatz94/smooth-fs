import { describe, expect, it } from 'bun:test';
import { timed } from './timing';
import type { AppLogger } from './logger';

interface LogEvent {
  level: 'debug' | 'warn' | 'error';
  payload: Record<string, unknown>;
  msg: string;
}

function makeSpyLogger(): {
  logger: AppLogger;
  events: LogEvent[];
} {
  const events: LogEvent[] = [];
  const record =
    (level: LogEvent['level']) =>
    (payload: Record<string, unknown>, msg: string): void => {
      events.push({ level, payload, msg });
    };
  const logger = {
    debug: record('debug'),
    warn: record('warn'),
    error: record('error'),
    info: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger,
  } as unknown as AppLogger;
  return { logger, events };
}

describe('timed() observability wrapper', () => {
  it('logs `debug` with elapsedMs under the slow threshold and returns the value', async () => {
    const { logger, events } = makeSpyLogger();
    const result = await timed(
      'fast.op',
      { logger, slowQueryMs: 500 },
      async () => 42,
      { folderId: 'abc' },
    );
    expect(result).toBe(42);
    expect(events).toHaveLength(1);
    const [evt] = events;
    expect(evt!.level).toBe('debug');
    expect(evt!.msg).toBe('db operation');
    expect(evt!.payload.op).toBe('fast.op');
    expect(evt!.payload.folderId).toBe('abc');
    expect(typeof evt!.payload.elapsedMs).toBe('number');
  });

  it('escalates to `warn` when operation exceeds slow threshold', async () => {
    const { logger, events } = makeSpyLogger();
    await timed(
      'slow.op',
      { logger, slowQueryMs: 5 },
      async () => {
        await new Promise((r) => setTimeout(r, 25));
      },
    );
    expect(events).toHaveLength(1);
    const [evt] = events;
    expect(evt!.level).toBe('warn');
    expect(evt!.msg).toBe('slow db operation');
    expect(evt!.payload.op).toBe('slow.op');
    expect((evt!.payload.elapsedMs as number) >= 5).toBe(true);
  });

  it('emits `error` and rethrows when the wrapped op throws', async () => {
    const { logger, events } = makeSpyLogger();
    await expect(
      timed('failing.op', { logger, slowQueryMs: 500 }, async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');
    expect(events).toHaveLength(1);
    const [evt] = events;
    expect(evt!.level).toBe('error');
    expect(evt!.msg).toBe('db operation failed');
    expect(evt!.payload.op).toBe('failing.op');
    expect(evt!.payload.err).toBe('kaboom');
    expect(typeof evt!.payload.elapsedMs).toBe('number');
  });
});
