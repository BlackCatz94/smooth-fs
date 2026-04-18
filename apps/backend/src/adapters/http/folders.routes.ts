import {
  apiEnvelopeSchema,
  contentsQuerySchema,
  folderContentsDataSchema,
  folderIdParamSchema,
  folderListDataSchema,
  folderPathDataSchema,
  folderRestoreDataSchema,
  folderSearchDataSchema,
  paginationQuerySchema,
  searchQuerySchema,
} from '@smoothfs/shared';
import { Elysia } from 'elysia';
import { toFileNodeDto, toFolderNodeDto } from '../../domain/folder';
import type { Container } from '../../infrastructure/container';
import { forRequest } from '../../infrastructure/logger';
import { buildMeta, resolveRequestId } from './helpers';

const folderListEnvelope = apiEnvelopeSchema(folderListDataSchema);
const folderContentsEnvelope = apiEnvelopeSchema(folderContentsDataSchema);
const folderSearchEnvelope = apiEnvelopeSchema(folderSearchDataSchema);
const folderRestoreEnvelope = apiEnvelopeSchema(folderRestoreDataSchema);
const folderPathEnvelope = apiEnvelopeSchema(folderPathDataSchema);

/**
 * Phase 3 HTTP surface: `/api/v1/folders/*`. Everything here is a thin adapter:
 * (1) validate the HTTP payload against the shared schemas, (2) call an
 * application service, (3) shape the result into the shared envelope.
 *
 * The controller *never* catches domain errors — they bubble to the global
 * `mapError` hook in `index.ts` so status codes stay centralised.
 */
export function buildFolderRoutes(container: Container) {
  const { env, logger, services } = container;

  return (
    new Elysia({ prefix: '/api/v1/folders' })
      // GET /api/v1/folders — root-level folders (parentId = null).
      .get('/', async ({ request, set, query }) => {
        const start = performance.now();
        const requestId = resolveRequestId(request);
        set.headers['x-request-id'] = requestId;
        const log = forRequest(logger, requestId);

        const { cursor, limit } = paginationQuerySchema.parse(query);
        const page = await services.listFolderChildren.exec({
          parentId: null,
          cursor: cursor ?? null,
          limit,
        });

        const endpointMs = Math.round(performance.now() - start);
        log.info(
          { op: 'folders.listRoot', limit, endpointMs, itemCount: page.items.length },
          'handled',
        );
        return folderListEnvelope.parse({
          data: { items: page.items.map(toFolderNodeDto) },
          meta: buildMeta({
            requestId,
            cursor: page.nextCursor,
            hasMore: page.nextCursor !== null,
            env: env.NODE_ENV,
            endpointMs,
          }),
        });
      })

      // GET /api/v1/folders/search?q=...
      //
      // Declared BEFORE `/:id/*` so Elysia's matcher doesn't treat "search" as
      // a UUID path param.
      .get('/search', async ({ request, set, query }) => {
        const start = performance.now();
        const requestId = resolveRequestId(request);
        set.headers['x-request-id'] = requestId;
        const log = forRequest(logger, requestId);

        const parsed = searchQuerySchema.parse(query);
        const page = await services.searchFolders.exec({
          query: parsed.q,
          cursor: parsed.cursor ?? null,
          limit: parsed.limit,
        });

        const endpointMs = Math.round(performance.now() - start);
        log.info(
          {
            op: 'folders.search',
            qLen: parsed.q.length,
            limit: parsed.limit,
            endpointMs,
            itemCount: page.items.length,
          },
          'handled',
        );
        return folderSearchEnvelope.parse({
          data: { items: page.items.map(toFolderNodeDto), query: parsed.q },
          meta: buildMeta({
            requestId,
            cursor: page.nextCursor,
            hasMore: page.nextCursor !== null,
            env: env.NODE_ENV,
            endpointMs,
          }),
        });
      })

      // GET /api/v1/folders/:id/children
      .get('/:id/children', async ({ request, set, params, query }) => {
        const start = performance.now();
        const requestId = resolveRequestId(request);
        set.headers['x-request-id'] = requestId;
        const log = forRequest(logger, requestId);

        const { id } = folderIdParamSchema.parse(params);
        const { cursor, limit } = paginationQuerySchema.parse(query);
        const page = await services.listFolderChildren.exec({
          parentId: id,
          cursor: cursor ?? null,
          limit,
        });

        const endpointMs = Math.round(performance.now() - start);
        log.info(
          {
            op: 'folders.listChildren',
            parentId: id,
            limit,
            endpointMs,
            itemCount: page.items.length,
          },
          'handled',
        );
        return folderListEnvelope.parse({
          data: { items: page.items.map(toFolderNodeDto) },
          meta: buildMeta({
            requestId,
            cursor: page.nextCursor,
            hasMore: page.nextCursor !== null,
            env: env.NODE_ENV,
            endpointMs,
          }),
        });
      })

      // GET /api/v1/folders/:id/contents — folders + files with dual cursors
      .get('/:id/contents', async ({ request, set, params, query }) => {
        const start = performance.now();
        const requestId = resolveRequestId(request);
        set.headers['x-request-id'] = requestId;
        const log = forRequest(logger, requestId);

        const { id } = folderIdParamSchema.parse(params);
        const { foldersCursor, filesCursor, limit } = contentsQuerySchema.parse(query);
        const contents = await services.getFolderContents.exec({
          folderId: id,
          foldersCursor: foldersCursor ?? null,
          filesCursor: filesCursor ?? null,
          limit,
        });

        const endpointMs = Math.round(performance.now() - start);
        log.info(
          {
            op: 'folders.getContents',
            folderId: id,
            limit,
            endpointMs,
            folderCount: contents.folders.items.length,
            fileCount: contents.files.items.length,
          },
          'handled',
        );
        return folderContentsEnvelope.parse({
          data: {
            folders: {
              items: contents.folders.items.map(toFolderNodeDto),
              nextCursor: contents.folders.nextCursor,
              hasMore: contents.folders.nextCursor !== null,
            },
            files: {
              items: contents.files.items.map(toFileNodeDto),
              nextCursor: contents.files.nextCursor,
              hasMore: contents.files.nextCursor !== null,
            },
          },
          meta: buildMeta({
            requestId,
            env: env.NODE_ENV,
            endpointMs,
          }),
        });
      })

      // GET /api/v1/folders/:id/path — path to root for breadcrumbs
      .get('/:id/path', async ({ request, set, params }) => {
        const start = performance.now();
        const requestId = resolveRequestId(request);
        set.headers['x-request-id'] = requestId;
        const log = forRequest(logger, requestId);

        const { id } = folderIdParamSchema.parse(params);
        const path = await services.getFolderPath.exec({ folderId: id });

        const endpointMs = Math.round(performance.now() - start);
        log.info(
          {
            op: 'folders.getPath',
            folderId: id,
            endpointMs,
            pathLength: path.length,
          },
          'handled',
        );
        return folderPathEnvelope.parse({
          data: { items: path.map(toFolderNodeDto) },
          meta: buildMeta({
            requestId,
            env: env.NODE_ENV,
            endpointMs,
          }),
        });
      })

      // POST /api/v1/folders/:id/restore — undo the most recent soft-delete event
      .post('/:id/restore', async ({ request, set, params }) => {
        const start = performance.now();
        const requestId = resolveRequestId(request);
        set.headers['x-request-id'] = requestId;
        const log = forRequest(logger, requestId);

        const { id } = folderIdParamSchema.parse(params);
        const result = await services.restoreFolder.exec({ folderId: id });

        const endpointMs = Math.round(performance.now() - start);
        log.info(
          {
            op: 'folders.restore',
            folderId: id,
            foldersRestored: result.foldersRestored,
            filesRestored: result.filesRestored,
            endpointMs,
          },
          'handled',
        );
        return folderRestoreEnvelope.parse({
          data: {
            id,
            foldersRestored: result.foldersRestored,
            filesRestored: result.filesRestored,
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
