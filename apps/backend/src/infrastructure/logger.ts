import pino, { type Logger } from 'pino';
import type { AppEnv } from '../env';

export type AppLogger = Logger;

let rootLogger: AppLogger | null = null;

export function createLogger(env: AppEnv): AppLogger {
  if (rootLogger) {
    return rootLogger;
  }
  const usePretty = env.NODE_ENV !== 'production';
  rootLogger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'smoothfs-backend', env: env.NODE_ENV },
    ...(usePretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l' },
          },
        }
      : {}),
  });
  return rootLogger;
}

/** Child logger keyed to a request ID; use this in request-scoped code paths. */
export function forRequest(parent: AppLogger, requestId: string): AppLogger {
  return parent.child({ requestId });
}
