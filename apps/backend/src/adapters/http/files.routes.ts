import {
  apiEnvelopeSchema,
  fileIdParamSchema,
  fileRestoreDataSchema,
} from '@smoothfs/shared';
import { Elysia } from 'elysia';
import type { Container } from '../../infrastructure/container';
import { forRequest } from '../../infrastructure/logger';
import { buildMeta, resolveRequestId } from './helpers';

const fileRestoreEnvelope = apiEnvelopeSchema(fileRestoreDataSchema);

/**
 * Phase 3 HTTP surface for individual file operations: `/api/v1/files/*`.
 *
 * Soft-delete (DELETE) and restore (POST `/:id/restore`) are the two
 * mutations exposed here. Restore exists at the file level so the frontend
 * "Undo delete" toast can target the exact row the user deleted, even when
 * the row was deleted in isolation (no parent folder soft-delete event to
 * piggy-back on).
 */
export function buildFileRoutes(container: Container) {
  const { env, logger, services } = container;

  return (
    new Elysia({ prefix: '/api/v1/files' })
      // DELETE /api/v1/files/:id — soft-delete a single file row.
      //
      // 204 on success, 404 (`FileNotFoundError`) for unknown ids — bubbles
      // through the global `mapError` hook so status codes stay centralised.
      .delete('/:id', async ({ request, set, params }) => {
        const start = performance.now();
        const requestId = resolveRequestId(request);
        set.headers['x-request-id'] = requestId;
        const log = forRequest(logger, requestId);

        const { id } = fileIdParamSchema.parse(params);
        await services.softDeleteFile.exec({ fileId: id });

        const endpointMs = Math.round(performance.now() - start);
        log.info({ op: 'files.softDelete', fileId: id, endpointMs }, 'handled');
        set.status = 204;
        return null;
      })

      // POST /api/v1/files/:id/restore — undo a single-file soft-delete.
      //
      // Returns 200 with the restored file id and the prior `deletedAt`
      // for telemetry. 404 for unknown ids, 409 (`FileNotDeletedError`)
      // if the row is already live — both flow through the global mapper.
      .post('/:id/restore', async ({ request, set, params }) => {
        const start = performance.now();
        const requestId = resolveRequestId(request);
        set.headers['x-request-id'] = requestId;
        const log = forRequest(logger, requestId);

        const { id } = fileIdParamSchema.parse(params);
        const result = await services.restoreFile.exec({ fileId: id });

        const endpointMs = Math.round(performance.now() - start);
        log.info(
          {
            op: 'files.restore',
            fileId: id,
            priorDeletedAt: result.priorDeletedAt?.toISOString() ?? null,
            endpointMs,
          },
          'handled',
        );
        return fileRestoreEnvelope.parse({
          data: {
            id,
            priorDeletedAt: result.priorDeletedAt
              ? result.priorDeletedAt.toISOString()
              : null,
          },
          meta: buildMeta({
            requestId,
            env: env.NODE_ENV,
            endpointMs,
          }),
        });
      })
  );
}
