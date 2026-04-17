import type { FileItem, Folder } from '../../domain/folder';
import type { AppLogger } from '../../infrastructure/logger';
import type { Cache } from '../../infrastructure/cache';
import type {
  FolderContents,
  FolderRepository,
  GetFolderContentsInput,
  ListChildrenInput,
  Page,
  RestoreFolderInput,
  RestoreFolderResult,
  SearchFoldersInput,
  SoftDeleteFolderInput,
} from '../../ports/folder-repository';

export interface CachingOptions {
  readonly ttlMs: number;
  /** Must end with `:` so the sweep pattern `${prefix}*` matches every key. */
  readonly keyPrefix: string;
  readonly logger: AppLogger;
}

/**
 * Cache-aside decorator for `FolderRepository`. Wraps read paths that the
 * Phase 3 plan pins as hot (`listChildren`, `getFolderContents`, `getPathToRoot`)
 * and invalidates the whole folder namespace on any write (`softDelete`,
 * `restore`). Coarse invalidation is intentional: precise per-subtree keys
 * would require tree traversal on every write, which defeats the cache.
 *
 * The decorator is unaware of domain semantics — it only translates between
 * domain `Date` fields and JSON-safe ISO strings at the cache boundary so the
 * port contract (returns `Date`s) stays intact.
 */
export class CachingFolderRepository implements FolderRepository {
  constructor(
    private readonly inner: FolderRepository,
    private readonly cache: Cache,
    private readonly opts: CachingOptions,
  ) {}

  async listChildren(input: ListChildrenInput): Promise<Page<Folder>> {
    const key = this.key(
      'children',
      input.parentId ?? 'root',
      String(input.limit),
      input.cursor ?? '-',
    );
    const hit = await this.cache.get<Page<FolderWire>>(key);
    if (hit) {
      return { items: hit.items.map(reviveFolder), nextCursor: hit.nextCursor };
    }
    const page = await this.inner.listChildren(input);
    await this.cache.set(key, toWireFolderPage(page), this.opts.ttlMs);
    return page;
  }

  async getById(folderId: string): Promise<Folder | null> {
    // Single-row lookups are fast and heavily invalidated; skip the cache to
    // avoid surprising stale reads after writes that *didn't* sweep this key.
    return this.inner.getById(folderId);
  }

  async getPathToRoot(folderId: string, maxDepth: number): Promise<readonly Folder[]> {
    const key = this.key('path', folderId, String(maxDepth));
    const hit = await this.cache.get<readonly FolderWire[]>(key);
    if (hit) {
      return hit.map(reviveFolder);
    }
    const path = await this.inner.getPathToRoot(folderId, maxDepth);
    await this.cache.set(key, path.map(toWireFolder), this.opts.ttlMs);
    return path;
  }

  async getFolderContents(input: GetFolderContentsInput): Promise<FolderContents> {
    const key = this.key(
      'contents',
      input.folderId,
      String(input.limit),
      input.foldersCursor ?? '-',
      input.filesCursor ?? '-',
    );
    const hit = await this.cache.get<FolderContentsWire>(key);
    if (hit) {
      return {
        folders: {
          items: hit.folders.items.map(reviveFolder),
          nextCursor: hit.folders.nextCursor,
        },
        files: {
          items: hit.files.items.map(reviveFile),
          nextCursor: hit.files.nextCursor,
        },
      };
    }
    const contents = await this.inner.getFolderContents(input);
    const wire: FolderContentsWire = {
      folders: toWireFolderPage(contents.folders),
      files: toWireFilePage(contents.files),
    };
    await this.cache.set(key, wire, this.opts.ttlMs);
    return contents;
  }

  async searchFolders(input: SearchFoldersInput): Promise<Page<Folder>> {
    // Search queries have high cardinality + aren't a Phase 3 hot path.
    return this.inner.searchFolders(input);
  }

  async softDelete(input: SoftDeleteFolderInput): Promise<void> {
    await this.inner.softDelete(input);
    await this.invalidateAll('softDelete', input.folderId);
  }

  async restore(input: RestoreFolderInput): Promise<RestoreFolderResult> {
    const result = await this.inner.restore(input);
    await this.invalidateAll('restore', input.folderId);
    return result;
  }

  private async invalidateAll(reason: string, folderId: string): Promise<void> {
    const pattern = `${this.opts.keyPrefix}*`;
    const removed = await this.cache.invalidatePattern(pattern);
    this.opts.logger.debug(
      { reason, folderId, pattern, removed },
      'folder cache invalidated',
    );
  }

  private key(...parts: string[]): string {
    return `${this.opts.keyPrefix}${parts.join(':')}`;
  }
}

/**
 * Wire types used inside the cache. Dates become ISO strings so the Redis
 * payload is plain JSON (no custom reviver required on the reader side).
 */
interface FolderWire {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

interface FileWire {
  readonly id: string;
  readonly folderId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

interface FolderContentsWire {
  readonly folders: Page<FolderWire>;
  readonly files: Page<FileWire>;
}

function toWireFolder(f: Folder): FolderWire {
  return {
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    deletedAt: f.deletedAt ? f.deletedAt.toISOString() : null,
  };
}

function toWireFile(f: FileItem): FileWire {
  return {
    id: f.id,
    folderId: f.folderId,
    name: f.name,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    deletedAt: f.deletedAt ? f.deletedAt.toISOString() : null,
  };
}

function reviveFolder(f: FolderWire): Folder {
  return {
    id: f.id,
    parentId: f.parentId,
    name: f.name,
    createdAt: new Date(f.createdAt),
    updatedAt: new Date(f.updatedAt),
    deletedAt: f.deletedAt ? new Date(f.deletedAt) : null,
  };
}

function reviveFile(f: FileWire): FileItem {
  return {
    id: f.id,
    folderId: f.folderId,
    name: f.name,
    createdAt: new Date(f.createdAt),
    updatedAt: new Date(f.updatedAt),
    deletedAt: f.deletedAt ? new Date(f.deletedAt) : null,
  };
}

function toWireFolderPage(p: Page<Folder>): Page<FolderWire> {
  return { items: p.items.map(toWireFolder), nextCursor: p.nextCursor };
}

function toWireFilePage(p: Page<FileItem>): Page<FileWire> {
  return { items: p.items.map(toWireFile), nextCursor: p.nextCursor };
}
