import { randomUUID } from 'node:crypto';

/**
 * Resolve the correlation ID for a request. Honors an inbound `x-request-id`
 * header when present (so upstream proxies / clients can thread their IDs into
 * our logs), otherwise mints a fresh UUID. Kept in a shared helper so every
 * route echoes the exact same rule.
 */
export function resolveRequestId(req: Request): string {
  const headerId = req.headers.get('x-request-id')?.trim();
  return headerId !== undefined && headerId.length > 0 ? headerId : randomUUID();
}

export interface DebugMeta {
  readonly endpointMs: number;
}

/**
 * Build the response meta block. `debug` is only attached outside production
 * so we don't leak timing data to real clients but still have it in dev + CI.
 */
export function buildMeta(input: {
  readonly requestId: string;
  readonly cursor?: string | null;
  readonly hasMore?: boolean;
  readonly env: 'development' | 'test' | 'production';
  readonly endpointMs: number;
  readonly extraDebug?: Record<string, unknown>;
}): {
  requestId: string;
  cursor?: string | null;
  hasMore?: boolean;
  debug?: Record<string, unknown>;
} {
  const meta: {
    requestId: string;
    cursor?: string | null;
    hasMore?: boolean;
    debug?: Record<string, unknown>;
  } = { requestId: input.requestId };
  if (input.cursor !== undefined) {
    meta.cursor = input.cursor;
  }
  if (input.hasMore !== undefined) {
    meta.hasMore = input.hasMore;
  }
  if (input.env !== 'production') {
    meta.debug = { endpointMs: input.endpointMs, ...(input.extraDebug ?? {}) };
  }
  return meta;
}
