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
  // Overloads: when `schema` is `null` the endpoint is expected to return
  // 204 No Content and the caller gets back `null`. Otherwise the caller
  // gets the parsed-and-validated `T`.
  function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: FetchOptions,
  ): Promise<T>;
  function request(
    path: string,
    schema: null,
    options?: FetchOptions,
  ): Promise<null>;
  function request<T>(
    path: string,
    schema: z.ZodType<T> | null,
    options: FetchOptions = {},
  ): Promise<T | null> {
    return doRequest(path, schema, options);
  }
  return request;

  async function doRequest<T>(
    path: string,
    schema: z.ZodType<T> | null,
    options: FetchOptions = {},
  ): Promise<T | null> {
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
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Compose the caller's signal (if any) with our timeout controller so
    // either source can abort the fetch. We deliberately avoid AbortSignal.any
    // for broader runtime support (Node < 20, older browsers in tests).
    const externalSignal = options.signal ?? null;
    const onExternalAbort = (): void => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    let response: Response;
    try {
      const { body, timeoutMs: _timeoutMs, query: _query, signal: _signal, ...restOptions } = options;
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
        if (externalSignal?.aborted && !timedOut) {
          throw new ApiClientError('Request aborted', 'ABORTED', 0, requestId);
        }
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
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
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

    // 204 No Content — no body to parse, no schema to validate. Callers that
    // want to assert "no body" pass `null` as the schema.
    if (response.status === 204 || schema === null) {
      return null;
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
  }
}
