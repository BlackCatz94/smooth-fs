/**
 * Unit tests for the caching decorator. Uses an in-memory fake Cache so we
 * can run these without Redis and still exercise the exact invalidation
 * + serialization contract.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import pino from 'pino';
import type { FileItem, Folder } from '../../domain/folder';
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
import { CachingFolderRepository } from './folder-repository.caching';

class InMemoryCache implements Cache {
  readonly store = new Map<string, { value: unknown; expiresAt: number }>();
  getCalls = 0;
  setCalls = 0;
  invalidateCalls: string[] = [];

  async get<T>(key: string): Promise<T | null> {
    this.getCalls += 1;
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    // Round-trip through JSON like a real cache does, so Date fields get
    // serialized and the decorator's revivers must cope.
    return JSON.parse(JSON.stringify(entry.value)) as T;
  }
  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.setCalls += 1;
    this.store.set(key, {
      value: JSON.parse(JSON.stringify(value)),
      expiresAt: Date.now() + ttlMs,
    });
  }
  async invalidatePattern(pattern: string): Promise<number> {
    this.invalidateCalls.push(pattern);
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    let removed = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
  async close(): Promise<void> {
    // no-op
  }
}

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    parentId: null,
    name: 'root',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: '00000000-0000-0000-0000-0000000000ff',
    folderId: '00000000-0000-0000-0000-000000000001',
    name: 'x.txt',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

class FakeFolderRepo implements FolderRepository {
  listChildrenCalls = 0;
  getPathCalls = 0;
  getContentsCalls = 0;
  searchCalls = 0;
  softDeleteCalls = 0;
  restoreCalls = 0;

  async listChildren(_input: ListChildrenInput): Promise<Page<Folder>> {
    this.listChildrenCalls += 1;
    return { items: [makeFolder({ name: 'a' })], nextCursor: null };
  }
  async getById(_id: string): Promise<Folder | null> {
    return makeFolder();
  }
  async getPathToRoot(_id: string, _maxDepth: number): Promise<readonly Folder[]> {
    this.getPathCalls += 1;
    return [makeFolder()];
  }
  async getFolderContents(_input: GetFolderContentsInput): Promise<FolderContents> {
    this.getContentsCalls += 1;
    return {
      folders: { items: [makeFolder({ name: 'sub' })], nextCursor: null },
      files: { items: [makeFile({ name: 'f.txt' })], nextCursor: null },
    };
  }
  async searchFolders(_input: SearchFoldersInput): Promise<Page<Folder>> {
    this.searchCalls += 1;
    return { items: [makeFolder({ name: 'hit' })], nextCursor: null };
  }
  async softDelete(_input: SoftDeleteFolderInput): Promise<void> {
    this.softDeleteCalls += 1;
  }
  async restore(_input: RestoreFolderInput): Promise<RestoreFolderResult> {
    this.restoreCalls += 1;
    return { foldersRestored: 1, filesRestored: 0, priorDeletedAt: new Date() };
  }
}

const logger = pino({ level: 'silent' });

function buildDecorator(): {
  cache: InMemoryCache;
  inner: FakeFolderRepo;
  decorator: CachingFolderRepository;
} {
  const cache = new InMemoryCache();
  const inner = new FakeFolderRepo();
  const decorator = new CachingFolderRepository(inner, cache, {
    ttlMs: 60_000,
    keyPrefix: 'cache:folders:',
    logger,
  });
  return { cache, inner, decorator };
}

describe('CachingFolderRepository', () => {
  let harness: ReturnType<typeof buildDecorator>;
  beforeEach(() => {
    harness = buildDecorator();
  });

  it('listChildren: cache miss then hit; only one inner call', async () => {
    const { inner, decorator, cache } = harness;
    const p1 = await decorator.listChildren({ parentId: null, cursor: null, limit: 10 });
    const p2 = await decorator.listChildren({ parentId: null, cursor: null, limit: 10 });
    expect(inner.listChildrenCalls).toBe(1);
    expect(p1.items[0]?.name).toBe('a');
    expect(p2.items[0]?.name).toBe('a');
    // Dates must survive the JSON round-trip back to Date instances.
    expect(p2.items[0]?.createdAt).toBeInstanceOf(Date);
    expect(cache.store.size).toBe(1);
  });

  it('listChildren: cache key varies by parentId and cursor', async () => {
    const { inner, decorator } = harness;
    await decorator.listChildren({ parentId: null, cursor: null, limit: 10 });
    await decorator.listChildren({ parentId: 'xyz', cursor: null, limit: 10 });
    await decorator.listChildren({ parentId: null, cursor: 'c', limit: 10 });
    expect(inner.listChildrenCalls).toBe(3);
  });

  it('getFolderContents: revives folder + file Dates from cached JSON', async () => {
    const { inner, decorator } = harness;
    await decorator.getFolderContents({
      folderId: 'x',
      foldersCursor: null,
      filesCursor: null,
      limit: 10,
    });
    const cached = await decorator.getFolderContents({
      folderId: 'x',
      foldersCursor: null,
      filesCursor: null,
      limit: 10,
    });
    expect(inner.getContentsCalls).toBe(1);
    expect(cached.folders.items[0]?.updatedAt).toBeInstanceOf(Date);
    expect(cached.files.items[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('softDelete: calls inner then invalidates the folder namespace', async () => {
    const { cache, inner, decorator } = harness;
    await decorator.listChildren({ parentId: null, cursor: null, limit: 10 });
    expect(cache.store.size).toBe(1);
    await decorator.softDelete({
      folderId: 'x',
      deletedAt: new Date(),
      maxDepth: 10,
    });
    expect(inner.softDeleteCalls).toBe(1);
    expect(cache.invalidateCalls).toContain('cache:folders:*');
    expect(cache.store.size).toBe(0);
  });

  it('restore: invalidates cache and forwards result', async () => {
    const { cache, inner, decorator } = harness;
    await decorator.listChildren({ parentId: null, cursor: null, limit: 10 });
    const result = await decorator.restore({
      folderId: 'x',
      restoredAt: new Date(),
      maxDepth: 10,
    });
    expect(inner.restoreCalls).toBe(1);
    expect(result.foldersRestored).toBe(1);
    expect(cache.invalidateCalls).toContain('cache:folders:*');
    expect(cache.store.size).toBe(0);
  });

  it('search: never cached (high cardinality + out of Phase 3 hot paths)', async () => {
    const { cache, inner, decorator } = harness;
    await decorator.searchFolders({ query: 'foo', cursor: null, limit: 10 });
    await decorator.searchFolders({ query: 'foo', cursor: null, limit: 10 });
    expect(inner.searchCalls).toBe(2);
    expect(cache.store.size).toBe(0);
  });
});
