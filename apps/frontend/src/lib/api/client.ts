import { z } from 'zod';
import { apiErrorBodySchema } from '@smoothfs/shared';

// UUID v4 generator for request IDs
export function generateRequestId(): string {
  return crypto.randomUUID();
}

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly requestId: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    status: number,
    requestId: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface FetchOptions extends Omit<RequestInit, 'body'> {
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly query?: Record<string, string | number | boolean | null | undefined>;
}

export function createClient(baseUrl: string) {
  return async <T>(
    path: string,
    schema: z.ZodType<T>,
    options: FetchOptions = {},
  ): Promise<T> => {
    const url = new URL(path, baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const requestId = generateRequestId();
    const headers = new Headers(options.headers);
    headers.set('x-request-id', requestId);
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 10000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      const { body, timeoutMs: _timeoutMs, query: _query, ...restOptions } = options;
      const fetchOpts: RequestInit = {
        ...restOptions,
        headers,
        signal: controller.signal,
      };
      if (body !== undefined) {
        fetchOpts.body = JSON.stringify(body);
      }
      response = await fetch(url.toString(), fetchOpts);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiClientError('Request timed out', 'TIMEOUT', 0, requestId);
      }
      throw new ApiClientError(
        err instanceof Error ? err.message : 'Network error',
        'NETWORK_ERROR',
        0,
        requestId,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let errorBody;
      try {
        const raw = await response.json();
        errorBody = apiErrorBodySchema.parse(raw);
      } catch {
        throw new ApiClientError(
          `HTTP ${response.status} ${response.statusText}`,
          'UNKNOWN_ERROR',
          response.status,
          requestId,
        );
      }
      throw new ApiClientError(
        errorBody.error.message,
        errorBody.error.code,
        response.status,
        errorBody.meta.requestId,
        errorBody.error.details,
      );
    }

    let rawJson;
    try {
      rawJson = await response.json();
    } catch {
      throw new ApiClientError('Failed to parse JSON response', 'PARSE_ERROR', response.status, requestId);
    }

    try {
      return schema.parse(rawJson);
    } catch (err) {
      throw new ApiClientError(
        'Response failed schema validation',
        'SCHEMA_ERROR',
        response.status,
        requestId,
        err instanceof z.ZodError ? err.issues : err,
      );
    }
  };
}
