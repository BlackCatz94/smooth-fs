import { CleanupExpiredService } from '../application/cleanup-expired';
import { GetFolderContentsService } from '../application/get-folder-contents';
import { GetFolderPathService } from '../application/get-folder-path';
import { ListFolderChildrenService } from '../application/list-folder-children';
import { RestoreFileService } from '../application/restore-file';
import { RestoreFolderService } from '../application/restore-folder';
import { SearchFoldersService } from '../application/search-folders';
import { SoftDeleteFileService } from '../application/soft-delete-file';
import { SoftDeleteFolderService } from '../application/soft-delete-folder';
import { createDbHandle, type DbHandle } from '../adapters/db/db';
import { DrizzleCleanupRepository } from '../adapters/db/cleanup-repository.drizzle';
import { DrizzleFolderRepository } from '../adapters/db/folder-repository.drizzle';
import { CachingFolderRepository } from '../adapters/db/folder-repository.caching';
import { DrizzleFileRepository } from '../adapters/db/file-repository.drizzle';
import { CachingFileRepository } from '../adapters/db/file-repository.caching';
import type { FileRepository } from '../ports/file-repository';
import type { FolderRepository } from '../ports/folder-repository';
import type { AppEnv } from '../env';
import { createCache, type Cache } from './cache';
import { createLogger, type AppLogger } from './logger';
import type { TimingConfig } from './timing';

export interface Container {
  readonly env: AppEnv;
  readonly logger: AppLogger;
  readonly dbHandle: DbHandle;
  readonly timing: TimingConfig;
  readonly cache: Cache;
  readonly services: {
    readonly listFolderChildren: ListFolderChildrenService;
    readonly getFolderPath: GetFolderPathService;
    readonly getFolderContents: GetFolderContentsService;
    readonly searchFolders: SearchFoldersService;
    readonly softDeleteFolder: SoftDeleteFolderService;
    readonly restoreFolder: RestoreFolderService;
    readonly softDeleteFile: SoftDeleteFileService;
    readonly restoreFile: RestoreFileService;
    readonly cleanupExpired: CleanupExpiredService;
  };
  shutdown(): Promise<void>;
}

/**
 * Builds the composition root. All inward wiring (adapters → services) happens
 * here; controllers and workers receive services via this container.
 */
export function buildContainer(env: AppEnv): Container {
  const logger = createLogger(env);
  const dbHandle = createDbHandle(env);
  const timing: TimingConfig = {
    logger: logger.child({ component: 'db' }),
    slowQueryMs: env.DB_SLOW_QUERY_MS,
  };

  const cache = createCache(env, logger.child({ component: 'cache' }));

  // Caching decorator wraps the Drizzle adapter so services stay cache-agnostic.
  // When `ENABLE_CACHE=false` the decorator short-circuits to a pass-through
  // (no Redis hits, no extra latency).
  const folderCacheKeyPrefix = 'cache:folders:';
  const baseFolderRepo = new DrizzleFolderRepository(dbHandle, timing);
  const folderRepo: FolderRepository = env.ENABLE_CACHE
    ? new CachingFolderRepository(baseFolderRepo, cache, {
        ttlMs: env.CACHE_TTL_MS,
        keyPrefix: folderCacheKeyPrefix,
        logger: logger.child({ component: 'cache', scope: 'folders' }),
      })
    : baseFolderRepo;

  // Files share the folder cache namespace for invalidation only — a file
  // mutation must drop the cached `getFolderContents` payload that contains
  // it. We don't cache file *reads* (single-row, off the hot path).
  const baseFileRepo = new DrizzleFileRepository(dbHandle, timing);
  const fileRepo: FileRepository = env.ENABLE_CACHE
    ? new CachingFileRepository(baseFileRepo, cache, {
        folderCachePattern: `${folderCacheKeyPrefix}*`,
        logger: logger.child({ component: 'cache', scope: 'files' }),
      })
    : baseFileRepo;

  const cleanupRepo = new DrizzleCleanupRepository(dbHandle, timing);

  const services: Container['services'] = {
    listFolderChildren: new ListFolderChildrenService(folderRepo),
    getFolderPath: new GetFolderPathService(folderRepo, env.MAX_TREE_DEPTH),
    getFolderContents: new GetFolderContentsService(folderRepo),
    searchFolders: new SearchFoldersService(folderRepo),
    softDeleteFolder: new SoftDeleteFolderService(folderRepo, env.MAX_TREE_DEPTH),
    restoreFolder: new RestoreFolderService(folderRepo, env.MAX_TREE_DEPTH),
    softDeleteFile: new SoftDeleteFileService(fileRepo),
    restoreFile: new RestoreFileService(fileRepo),
    cleanupExpired: new CleanupExpiredService(cleanupRepo),
  };

  let closed = false;
  return {
    env,
    logger,
    dbHandle,
    timing,
    cache,
    services,
    async shutdown(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await cache.close();
      await dbHandle.close();
    },
  };
}
