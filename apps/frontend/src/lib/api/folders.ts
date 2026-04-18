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
import { createClient } from './client';
import { getEnv } from '../env';

const getClient = () => createClient(getEnv().VITE_API_BASE_URL);

export const foldersApi = {
  async getRoot(query?: PaginationQuery) {
    return getClient()('/api/v1/folders', apiEnvelopeSchema(folderListDataSchema), {
      method: 'GET',
      query: query as Record<string, string | number | boolean | null | undefined>,
    });
  },

  async getChildren(id: string, query?: PaginationQuery) {
    return getClient()(`/api/v1/folders/${id}/children`, apiEnvelopeSchema(folderListDataSchema), {
      method: 'GET',
      query: query as Record<string, string | number | boolean | null | undefined>,
    });
  },

  async getContents(id: string, query?: ContentsQuery) {
    return getClient()(`/api/v1/folders/${id}/contents`, apiEnvelopeSchema(folderContentsDataSchema), {
      method: 'GET',
      query: query as Record<string, string | number | boolean | null | undefined>,
    });
  },

  async search(query: SearchQuery) {
    return getClient()('/api/v1/folders/search', apiEnvelopeSchema(folderSearchDataSchema), {
      method: 'GET',
      query: query as Record<string, string | number | boolean | null | undefined>,
    });
  },

  async getPath(id: string) {
    return getClient()(`/api/v1/folders/${id}/path`, apiEnvelopeSchema(folderPathDataSchema), {
      method: 'GET',
    });
  },

  async restore(id: string) {
    return getClient()(`/api/v1/folders/${id}/restore`, apiEnvelopeSchema(folderRestoreDataSchema), {
      method: 'POST',
    });
  },
};
