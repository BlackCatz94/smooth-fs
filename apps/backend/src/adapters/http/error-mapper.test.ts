import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  DepthLimitExceededError,
  FolderNotFoundError,
  InvalidCursorError,
  InvalidInputError,
} from '../../domain/errors';
import { mapError } from './error-mapper';

const REQ = 'req-123';

describe('mapError', () => {
  it('maps FolderNotFoundError to 404 with its code', () => {
    const res = mapError(new FolderNotFoundError('abc'), REQ);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FOLDER_NOT_FOUND');
    expect(res.body.meta.requestId).toBe(REQ);
  });

  it('maps InvalidCursorError to 400', () => {
    const res = mapError(new InvalidCursorError('bad'), REQ);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CURSOR');
  });

  it('maps DepthLimitExceededError to 422', () => {
    const res = mapError(new DepthLimitExceededError(100, 64), REQ);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DEPTH_LIMIT_EXCEEDED');
  });

  it('maps InvalidInputError to 422 and keeps details', () => {
    const res = mapError(new InvalidInputError('oops', { field: 'name' }), REQ);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('maps ZodError to 422 VALIDATION_ERROR with issues', () => {
    const parseResult = z.object({ name: z.string() }).safeParse({ name: 123 });
    if (parseResult.success) throw new Error('expected zod failure');
    const res = mapError(parseResult.error, REQ);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });

  it('maps unknown errors to 500 INTERNAL_ERROR', () => {
    const res = mapError(new Error('boom'), REQ);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.message).toBe('boom');
  });
});
