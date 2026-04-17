import { z } from 'zod';

/**
 * Encoded pagination cursor: base64url(JSON.stringify(tuple)).
 * Phase 3 will fix tuple arity/order per endpoint (last-seen tuple).
 */
export const cursorTupleSchema = z.array(z.string()).min(1).max(16);

export type CursorTuple = z.infer<typeof cursorTupleSchema>;

function utf8ToBase64Url(input: string): string {
  const binary = Array.from(new TextEncoder().encode(input), (byte) =>
    String.fromCharCode(byte),
  ).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUtf8(encoded: string): string {
  let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  if (pad === 2) b64 += '==';
  else if (pad === 3) b64 += '=';
  else if (pad === 1) throw new Error('Invalid cursor encoding');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) ?? 0;
  }
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(tuple: CursorTuple): string {
  cursorTupleSchema.parse(tuple);
  const json = JSON.stringify(tuple);
  return utf8ToBase64Url(json);
}

export function decodeCursor(encoded: string): CursorTuple {
  const json = base64UrlToUtf8(encoded);
  const parsed: unknown = JSON.parse(json);
  return cursorTupleSchema.parse(parsed);
}
