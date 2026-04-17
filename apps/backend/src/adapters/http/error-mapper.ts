import type { ApiErrorBody } from '@smoothfs/shared';
import { ZodError } from 'zod';
import {
  DepthLimitExceededError,
  DomainError,
  FolderNotDeletedError,
  FolderNotFoundError,
  InvalidCursorError,
  InvalidInputError,
} from '../../domain/errors';

export interface MappedError {
  readonly status: number;
  readonly body: ApiErrorBody;
}

function statusFor(err: DomainError): number {
  if (err instanceof FolderNotFoundError) return 404;
  if (err instanceof FolderNotDeletedError) return 409;
  if (err instanceof InvalidCursorError) return 400;
  if (err instanceof DepthLimitExceededError) return 422;
  if (err instanceof InvalidInputError) return 422;
  return 500;
}

/**
 * Central error-to-HTTP translation. Every response body adheres to
 * `apiErrorBodySchema` (see `@smoothfs/shared`) with the request ID included.
 */
export function mapError(err: unknown, requestId: string): MappedError {
  if (err instanceof DomainError) {
    return {
      status: statusFor(err),
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
