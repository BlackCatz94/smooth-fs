import {
  apiEnvelopeSchema,
  fileRestoreDataSchema,
} from '@smoothfs/shared';
import { createClient, type FetchOptions } from './client';
import { getEnv } from '../env';

const getClient = () => createClient(getEnv().VITE_API_BASE_URL);

interface RequestExtras {
  readonly signal?: AbortSignal;
}

function opts(method: 'DELETE' | 'POST', extras?: RequestExtras): FetchOptions {
  const out: { -readonly [K in keyof FetchOptions]: FetchOptions[K] } = { method };
  if (extras?.signal) out.signal = extras.signal;
  return out;
}

const fileRestoreEnvelope = apiEnvelopeSchema(fileRestoreDataSchema);

/**
 * File-scoped HTTP client. Folders and files are separate resources at the
 * backend (`/api/v1/folders/*` vs `/api/v1/files/*`), so we keep their
 * clients separate too rather than overloading `foldersApi`.
 */
export const filesApi = {
  /**
   * Soft-deletes a file. Server responds 204 — pass `null` schema so the
   * client doesn't try to parse a body.
   */
  async softDelete(id: string, extras?: RequestExtras): Promise<void> {
    await getClient()(`/api/v1/files/${id}`, null, opts('DELETE', extras));
  },

  /**
   * Undoes a single-file soft-delete. Returns the parsed envelope so callers
   * can log `priorDeletedAt` if useful — typical UI flow ignores the body and
   * just refreshes the contents grid.
   */
  async restore(id: string, extras?: RequestExtras) {
    return getClient()(
      `/api/v1/files/${id}/restore`,
      fileRestoreEnvelope,
      opts('POST', extras),
    );
  },
};
