import { CleanupExpiredService } from '../application/cleanup-expired';
import { GetFolderContentsService } from '../application/get-folder-contents';
import { GetFolderPathService } from '../application/get-folder-path';
import { ListFolderChildrenService } from '../application/list-folder-children';
import { SoftDeleteFolderService } from '../application/soft-delete-folder';
import { createDbHandle, type DbHandle } from '../adapters/db/db';
import { DrizzleCleanupRepository } from '../adapters/db/cleanup-repository.drizzle';
import { DrizzleFolderRepository } from '../adapters/db/folder-repository.drizzle';
import type { AppEnv } from '../env';
import { createLogger, type AppLogger } from './logger';
import type { TimingConfig } from './timing';

export interface Container {
  readonly env: AppEnv;
  readonly logger: AppLogger;
  readonly dbHandle: DbHandle;
  readonly timing: TimingConfig;
  readonly services: {
    readonly listFolderChildren: ListFolderChildrenService;
    readonly getFolderPath: GetFolderPathService;
    readonly getFolderContents: GetFolderContentsService;
    readonly softDeleteFolder: SoftDeleteFolderService;
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

  const folderRepo = new DrizzleFolderRepository(dbHandle, timing);
  const cleanupRepo = new DrizzleCleanupRepository(dbHandle, timing);

  const services: Container['services'] = {
    listFolderChildren: new ListFolderChildrenService(folderRepo),
    getFolderPath: new GetFolderPathService(folderRepo, env.MAX_TREE_DEPTH),
    getFolderContents: new GetFolderContentsService(folderRepo),
    softDeleteFolder: new SoftDeleteFolderService(folderRepo, env.MAX_TREE_DEPTH),
    cleanupExpired: new CleanupExpiredService(cleanupRepo),
  };

  let closed = false;
  return {
    env,
    logger,
    dbHandle,
    timing,
    services,
    async shutdown(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await dbHandle.close();
    },
  };
}
