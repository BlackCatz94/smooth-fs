import { ApiClientError } from './client';

/**
 * Structured UI-friendly error. We keep `requestId` so toasts/logs can
 * correlate to backend logs, `code` so components can branch on well-known
 * failures (e.g. NOT_FOUND -> empty state), and `op` so triage is fast when
 * the same composable performs multiple network operations.
 */
export interface UiError {
  readonly message: string;
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly op: string;
}

export function normalizeUiError(err: unknown, op: string): UiError {
  if (err instanceof ApiClientError) {
    return {
      message: err.message,
      code: err.code,
      status: err.status,
      requestId: err.requestId,
      op,
    };
  }
  return {
    message: err instanceof Error ? err.message : String(err),
    code: 'UNKNOWN_ERROR',
    status: 0,
    requestId: null,
    op,
  };
}
