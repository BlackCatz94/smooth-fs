import type { ApiErrorBody } from '@smoothfs/shared';
import { ZodError } from 'zod';
import { DomainError } from '../../domain/errors';

export interface MappedError {
  readonly status: number;
  readonly body: ApiErrorBody;
}

/**
 * Central error-to-HTTP translation. Every response body adheres to
 * `apiErrorBodySchema` (see `@smoothfs/shared`) with the request ID included.
 *
 * HTTP status codes are carried by each `DomainError` subclass via
 * `httpStatus`, so adding a new domain error type does not require editing
 * this mapper (Open/Closed).
 */
export function mapError(err: unknown, requestId: string): MappedError {
  if (err instanceof DomainError) {
    return {
      status: err.httpStatus,
      body: {
        error: { code: err.code, message: err.message },
        meta: { requestId },
      },
    };
  }
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request failed schema validation',
          details: err.issues,
        },
        meta: { requestId },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      meta: { requestId },
    },
  };
}
