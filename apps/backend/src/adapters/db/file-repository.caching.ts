import type { FileItem } from '../../domain/folder';
import type { AppLogger } from '../../infrastructure/logger';
import type { Cache } from '../../infrastructure/cache';
import type {
  FileRepository,
  RestoreFileInput,
  RestoreFileResult,
  SoftDeleteFileInput,
} from '../../ports/file-repository';

export interface FileCachingOptions {
  /**
   * Pattern used to invalidate folder-contents caches when a file write
   * happens. We share the folder-cache prefix because deleting a file
   * mutates that folder's cached `getFolderContents` payload — leaving a
   * stale tile in the right panel until TTL expires would be visibly wrong.
   */
  readonly folderCachePattern: string;
  readonly logger: AppLogger;
}

/**
 * Cache-aware decorator for `FileRepository`. We don't *read* through the
 * cache for files (single-row lookups are cheap and not on the hot read
 * path); the decorator exists purely to invalidate the *folder* cache
 * namespace whenever a file mutates. Without this, a file deleted via
 * `DELETE /api/v1/files/:id` would still appear in `/folders/:id/contents`
 * for up to `CACHE_TTL_MS` because that cache is keyed on folder id.
 *
 * Decorator preferred over baking invalidation into the service so the
 * service layer remains pure (no cache concept).
 */
export class CachingFileRepository implements FileRepository {
  constructor(
    private readonly inner: FileRepository,
    private readonly cache: Cache,
    private readonly opts: FileCachingOptions,
  ) {}

  async getById(fileId: string): Promise<FileItem | null> {
    return this.inner.getById(fileId);
  }

  async getAnyById(fileId: string): Promise<FileItem | null> {
    return this.inner.getAnyById(fileId);
  }

  async softDelete(input: SoftDeleteFileInput): Promise<void> {
    await this.inner.softDelete(input);
    const removed = await this.cache.invalidatePattern(this.opts.folderCachePattern);
    this.opts.logger.debug(
      {
        reason: 'file.softDelete',
        fileId: input.fileId,
        pattern: this.opts.folderCachePattern,
        removed,
      },
      'folder cache invalidated by file write',
    );
  }

  async restore(input: RestoreFileInput): Promise<RestoreFileResult> {
    const result = await this.inner.restore(input);
    // Same invalidation rule as softDelete: a restored file becomes visible
    // again in `getFolderContents`, and the cached payload would still hide
    // it until TTL expires. We invalidate AFTER the write so a concurrent
    // read can never observe the cache entry without the restored row.
    const removed = await this.cache.invalidatePattern(this.opts.folderCachePattern);
    this.opts.logger.debug(
      {
        reason: 'file.restore',
        fileId: input.fileId,
        pattern: this.opts.folderCachePattern,
        removed,
      },
      'folder cache invalidated by file write',
    );
    return result;
  }
}
