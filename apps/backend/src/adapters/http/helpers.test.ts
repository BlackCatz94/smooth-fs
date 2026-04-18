import { describe, expect, it } from 'bun:test';
import { buildMeta, resolveRequestId } from './helpers';

describe('resolveRequestId', () => {
  it('honors a supplied x-request-id header', () => {
    const req = new Request('http://localhost/x', {
      headers: { 'x-request-id': 'req-external-123' },
    });
    expect(resolveRequestId(req)).toBe('req-external-123');
  });

  it('trims whitespace in the supplied header', () => {
    const req = new Request('http://localhost/x', {
      headers: { 'x-request-id': '   req-trim-1   ' },
    });
    expect(resolveRequestId(req)).toBe('req-trim-1');
  });

  it('mints a fresh uuid when no header is supplied', () => {
    const req = new Request('http://localhost/x');
    const id = resolveRequestId(req);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('mints a fresh uuid when the header is empty-after-trim', () => {
    const req = new Request('http://localhost/x', {
      headers: { 'x-request-id': '    ' },
    });
    const id = resolveRequestId(req);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('buildMeta', () => {
  it('attaches debug in non-production envs with endpointMs and extras', () => {
    const meta = buildMeta({
      requestId: 'req-1',
      env: 'development',
      endpointMs: 17,
      extraDebug: { cacheHit: true },
    });
    expect(meta.requestId).toBe('req-1');
    expect(meta.debug).toEqual({ endpointMs: 17, cacheHit: true });
  });

  it('omits debug in production', () => {
    const meta = buildMeta({
      requestId: 'req-2',
      env: 'production',
      endpointMs: 99,
    });
    expect(meta.debug).toBeUndefined();
  });

  it('propagates cursor/hasMore when provided', () => {
    const meta = buildMeta({
      requestId: 'req-3',
      env: 'test',
      endpointMs: 3,
      cursor: 'cur-x',
      hasMore: true,
    });
    expect(meta.cursor).toBe('cur-x');
    expect(meta.hasMore).toBe(true);
  });

  it('keeps cursor=null distinct from "not provided"', () => {
    const meta = buildMeta({
      requestId: 'req-4',
      env: 'test',
      endpointMs: 3,
      cursor: null,
    });
    expect(meta.cursor).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(meta, 'hasMore')).toBe(false);
  });
});
