import {
  apiEnvelopeSchema,
  folderContentsDataSchema,
  folderListDataSchema,
  folderPathDataSchema,
  folderRestoreDataSchema,
  folderSearchDataSchema,
  type ContentsQuery,
  type PaginationQuery,
  type SearchQuery,
} from '@smoothfs/shared';
import { createClient, type FetchOptions } from './client';
import { getEnv } from '../env';

const getClient = () => createClient(getEnv().VITE_API_BASE_URL);

interface RequestExtras {
  readonly signal?: AbortSignal;
}

type Query = Record<string, string | number | boolean | null | undefined>;

/**
 * Build a `FetchOptions` object that only sets `signal`/`query` when defined.
 * TypeScript's `exactOptionalPropertyTypes` treats `{ signal: undefined }` as
 * *distinct* from omitting the key — this helper keeps the call sites tidy.
 */
function opts(
  method: 'GET' | 'POST' | 'DELETE',
  query?: Query,
  extras?: RequestExtras,
): FetchOptions {
  const out: { -readonly [K in keyof FetchOptions]: FetchOptions[K] } = { method };
  if (query !== undefined) out.query = query;
  if (extras?.signal) out.signal = extras.signal;
  return out;
}

export const foldersApi = {
  async getRoot(query?: PaginationQuery, extras?: RequestExtras) {
    return getClient()(
      '/api/v1/folders',
      apiEnvelopeSchema(folderListDataSchema),
      opts('GET', query as Query | undefined, extras),
    );
  },

  async getChildren(id: string, query?: PaginationQuery, extras?: RequestExtras) {
    return getClient()(
      `/api/v1/folders/${id}/children`,
      apiEnvelopeSchema(folderListDataSchema),
      opts('GET', query as Query | undefined, extras),
    );
  },

  async getContents(id: string, query?: ContentsQuery, extras?: RequestExtras) {
    return getClient()(
      `/api/v1/folders/${id}/contents`,
      apiEnvelopeSchema(folderContentsDataSchema),
      opts('GET', query as Query | undefined, extras),
    );
  },

  async search(query: SearchQuery, extras?: RequestExtras) {
    return getClient()(
      '/api/v1/folders/search',
      apiEnvelopeSchema(folderSearchDataSchema),
      opts('GET', query as Query, extras),
    );
  },

  async getPath(id: string, extras?: RequestExtras) {
    return getClient()(
      `/api/v1/folders/${id}/path`,
      apiEnvelopeSchema(folderPathDataSchema),
      opts('GET', undefined, extras),
    );
  },

  async restore(id: string, extras?: RequestExtras) {
    return getClient()(
      `/api/v1/folders/${id}/restore`,
      apiEnvelopeSchema(folderRestoreDataSchema),
      opts('POST', undefined, extras),
    );
  },

  /**
   * Soft-deletes the folder (and its subtree). The server responds 204 No
   * Content — we pass `null` as the schema so the client doesn't try to parse
   * a body.
   */
  async softDelete(id: string, extras?: RequestExtras): Promise<void> {
    await getClient()(
      `/api/v1/folders/${id}`,
      null,
      opts('DELETE', undefined, extras),
    );
  },
};
