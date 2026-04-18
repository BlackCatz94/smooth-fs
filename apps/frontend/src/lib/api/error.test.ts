import { describe, it, expect } from 'vitest';
import { ApiClientError } from './client';
import { normalizeUiError } from './error';

describe('normalizeUiError', () => {
  it('preserves server requestId and code from ApiClientError for UI -> log correlation', () => {
    const err = new ApiClientError('boom', 'FOLDER_NOT_FOUND', 404, 'srv-req-abc', { x: 1 });
    const ui = normalizeUiError(err, 'loadChildren');
    expect(ui).toEqual({
      message: 'boom',
      code: 'FOLDER_NOT_FOUND',
      status: 404,
      requestId: 'srv-req-abc',
      op: 'loadChildren',
    });
  });

  it('tags the op so multi-step composables can disambiguate which call failed', () => {
    const err = new ApiClientError('timed out', 'TIMEOUT', 0, 'req-1');
    const a = normalizeUiError(err, 'getRoot');
    const b = normalizeUiError(err, 'getPath');
    expect(a.op).toBe('getRoot');
    expect(b.op).toBe('getPath');
    expect(a.requestId).toBe('req-1');
    expect(b.requestId).toBe('req-1');
  });

  it('falls back to UNKNOWN_ERROR shape when an unknown throwable is passed', () => {
    const ui = normalizeUiError(new Error('nope'), 'loadRoot');
    expect(ui.code).toBe('UNKNOWN_ERROR');
    expect(ui.message).toBe('nope');
    expect(ui.status).toBe(0);
    expect(ui.requestId).toBeNull();
    expect(ui.op).toBe('loadRoot');
  });

  it('handles non-Error throwables without crashing', () => {
    const ui = normalizeUiError('string error', 'search');
    expect(ui.code).toBe('UNKNOWN_ERROR');
    expect(ui.message).toBe('string error');
    expect(ui.requestId).toBeNull();
  });

  it('preserves the frozen shape for every code path (regression guard)', () => {
    const cases: unknown[] = [
      new ApiClientError('a', 'CODE_A', 422, 'r-1'),
      new ApiClientError('b', 'CODE_B', 500, 'r-2'),
      new Error('c'),
      42,
    ];
    const keys = ['message', 'code', 'status', 'requestId', 'op'].sort();
    for (const input of cases) {
      const ui = normalizeUiError(input, 'op');
      expect(Object.keys(ui).sort()).toEqual(keys);
    }
  });
});
