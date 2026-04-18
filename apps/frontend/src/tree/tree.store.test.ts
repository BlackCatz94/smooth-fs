import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { FolderNode } from '@smoothfs/shared';

const mockFolder = (id: string, parentId: string | null = null): FolderNode => ({
  id,
  name: `Folder ${id}`,
  parentId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
  hasChildFolders: true,
});

// Hoist-safe mock: `vi.mock` is hoisted, so we expose mutable call handlers via
// `vi.hoisted` so individual tests can reprogram responses per-call.
const mocks = vi.hoisted(() => ({
  getRoot: vi.fn(),
  getChildren: vi.fn(),
  getPath: vi.fn(),
  getContents: vi.fn(),
  search: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('@/lib/api/folders', () => ({
  foldersApi: {
    getRoot: mocks.getRoot,
    getChildren: mocks.getChildren,
    getPath: mocks.getPath,
    getContents: mocks.getContents,
    search: mocks.search,
    restore: mocks.restore,
  },
}));

// Import AFTER the mock is registered so the store binds to the mock module.
import { useTreeStore } from './tree.store';

describe('tree store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    mocks.getRoot.mockReset();
    mocks.getChildren.mockReset();
    mocks.getPath.mockReset();
    mocks.restore.mockReset();
  });

  it('loadRoot populates nodes and rootIds once', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1'), mockFolder('r2')] },
      meta: { requestId: 'req-1' },
    });

    const tree = useTreeStore();
    await tree.loadRoot();

    expect(tree.rootIds).toEqual(['r1', 'r2']);
    expect(tree.nodes['r1']).toBeDefined();
    expect(tree.nodes['r2']).toBeDefined();
    expect(tree.loading.has('root')).toBe(false);
  });

  it('expand/select are independent: selecting does not expand', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-1' },
    });

    const tree = useTreeStore();
    await tree.loadRoot();

    tree.select('r1');
    expect(tree.selectedId).toBe('r1');
    expect(tree.expanded.has('r1')).toBe(false);
    // Selecting must never trigger a children fetch.
    expect(mocks.getChildren).not.toHaveBeenCalled();
  });

  it('lazy-loads children on first expand, and reuses cache on second expand', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-1' },
    });
    mocks.getChildren.mockResolvedValue({
      data: { items: [mockFolder('c1', 'r1'), mockFolder('c2', 'r1')] },
      meta: { requestId: 'req-2' },
    });

    const tree = useTreeStore();
    await tree.loadRoot();

    await tree.toggleExpand('r1');
    expect(mocks.getChildren).toHaveBeenCalledTimes(1);
    expect(tree.expanded.has('r1')).toBe(true);
    expect(tree.children['r1']).toEqual(['c1', 'c2']);

    // Collapse + re-expand should NOT refetch (children cache sticks).
    await tree.toggleExpand('r1');
    expect(tree.expanded.has('r1')).toBe(false);
    await tree.toggleExpand('r1');
    expect(mocks.getChildren).toHaveBeenCalledTimes(1);
  });

  it('persists selection + expanded ids and rehydrates from storage', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-1' },
    });
    mocks.getChildren.mockResolvedValue({
      data: { items: [mockFolder('c1', 'r1')] },
      meta: { requestId: 'req-2' },
    });

    const tree = useTreeStore();
    await tree.loadRoot();
    await tree.toggleExpand('r1');
    tree.select('c1');

    // Allow watchers to flush.
    await new Promise((r) => setTimeout(r, 0));

    // New store (simulating a fresh tab) should see the persisted blob.
    setActivePinia(createPinia());
    const tree2 = useTreeStore();
    const persisted = tree2.hydrateFromStorage();
    expect(persisted.selectedId).toBe('c1');
    expect(persisted.expanded).toContain('r1');
    expect(tree2.selectedId).toBe('c1');
    expect(tree2.expanded.has('r1')).toBe(true);
  });

  it('expand fetches one page and records hasMore + cursor without eager paging', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-root', hasMore: false, cursor: null },
    });
    mocks.getChildren.mockResolvedValueOnce({
      data: { items: [mockFolder('c1', 'r1'), mockFolder('c2', 'r1')] },
      meta: { requestId: 'req-page-1', hasMore: true, cursor: 'cur-1' },
    });

    const tree = useTreeStore();
    await tree.loadRoot();
    await tree.toggleExpand('r1');

    // Exactly ONE fetch — the store must not eagerly drain every page.
    expect(mocks.getChildren).toHaveBeenCalledTimes(1);
    expect(tree.children['r1']).toEqual(['c1', 'c2']);
    expect(tree.childrenHasMore['r1']).toBe(true);
    expect(tree.childrenCursor['r1']).toBe('cur-1');
  });

  it('loadMoreChildren fetches the next page using the stored cursor and merges', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-root', hasMore: false, cursor: null },
    });
    mocks.getChildren
      .mockResolvedValueOnce({
        data: { items: [mockFolder('c1', 'r1'), mockFolder('c2', 'r1')] },
        meta: { requestId: 'req-page-1', hasMore: true, cursor: 'cur-1' },
      })
      .mockResolvedValueOnce({
        data: { items: [mockFolder('c3', 'r1')] },
        meta: { requestId: 'req-page-2', hasMore: false, cursor: null },
      });

    const tree = useTreeStore();
    await tree.loadRoot();
    await tree.toggleExpand('r1');
    await tree.loadMoreChildren('r1');

    expect(mocks.getChildren).toHaveBeenCalledTimes(2);
    expect(mocks.getChildren.mock.calls[1]?.[1]).toMatchObject({ cursor: 'cur-1' });
    expect(tree.children['r1']).toEqual(['c1', 'c2', 'c3']);
    expect(tree.childrenHasMore['r1']).toBe(false);
  });

  it('loadMoreChildren is a no-op when hasMore is false', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-root', hasMore: false, cursor: null },
    });
    mocks.getChildren.mockResolvedValueOnce({
      data: { items: [mockFolder('c1', 'r1')] },
      meta: { requestId: 'req-page-1', hasMore: false, cursor: null },
    });

    const tree = useTreeStore();
    await tree.loadRoot();
    await tree.toggleExpand('r1');

    mocks.getChildren.mockClear();
    await tree.loadMoreChildren('r1');
    expect(mocks.getChildren).not.toHaveBeenCalled();
  });

  it('collapsing a parent also collapses every already-loaded descendant', async () => {
    // Shape: r1 > c1 > g1 (expanded) ; r1 > c2 (expanded leaf w/ 0 kids).
    // Collapsing r1 must strip r1, c1, c2, and g1 from `expanded` so a later
    // re-expand does not magically unfold the whole subtree.
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-root', hasMore: false, cursor: null },
    });
    mocks.getChildren
      // r1 -> c1, c2
      .mockResolvedValueOnce({
        data: { items: [mockFolder('c1', 'r1'), mockFolder('c2', 'r1')] },
        meta: { requestId: 'req-r1', hasMore: false, cursor: null },
      })
      // c1 -> g1
      .mockResolvedValueOnce({
        data: { items: [mockFolder('g1', 'c1')] },
        meta: { requestId: 'req-c1', hasMore: false, cursor: null },
      })
      // c2 -> (empty)
      .mockResolvedValueOnce({
        data: { items: [] },
        meta: { requestId: 'req-c2', hasMore: false, cursor: null },
      })
      // g1 -> (empty)
      .mockResolvedValueOnce({
        data: { items: [] },
        meta: { requestId: 'req-g1', hasMore: false, cursor: null },
      });

    const tree = useTreeStore();
    await tree.loadRoot();
    await tree.toggleExpand('r1');
    await tree.toggleExpand('c1');
    await tree.toggleExpand('c2');
    await tree.toggleExpand('g1');

    expect(tree.expanded.has('r1')).toBe(true);
    expect(tree.expanded.has('c1')).toBe(true);
    expect(tree.expanded.has('c2')).toBe(true);
    expect(tree.expanded.has('g1')).toBe(true);

    await tree.toggleExpand('r1'); // collapse

    expect(tree.expanded.has('r1')).toBe(false);
    expect(tree.expanded.has('c1')).toBe(false);
    expect(tree.expanded.has('c2')).toBe(false);
    expect(tree.expanded.has('g1')).toBe(false);
  });

  it('normalizes errors into UiError with op label', async () => {
    mocks.getRoot.mockRejectedValue(new Error('boom'));

    const tree = useTreeStore();
    await tree.loadRoot();

    expect(tree.error).not.toBeNull();
    expect(tree.error!.op).toBe('loadRoot');
    expect(tree.error!.code).toBe('UNKNOWN_ERROR');
    expect(tree.error!.message).toContain('boom');
  });

  it('restoreFolder calls the API and force-reloads the parent\'s children', async () => {
    // Setup: r1 with one live child c1. We simulate the deleted c1 coming
    // back by reprogramming `getChildren` to return [c1, c2] on the second
    // call (the post-restore reload).
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-root' },
    });
    mocks.getChildren
      .mockResolvedValueOnce({
        data: { items: [mockFolder('c1', 'r1')] },
        meta: { requestId: 'req-children-1' },
      })
      .mockResolvedValueOnce({
        data: { items: [mockFolder('c1', 'r1'), mockFolder('c2', 'r1')] },
        meta: { requestId: 'req-children-2' },
      });
    mocks.restore.mockResolvedValue({
      data: { id: 'c2', foldersRestored: 1, filesRestored: 0, priorDeletedAt: null },
      meta: { requestId: 'req-restore' },
    });

    const tree = useTreeStore();
    await tree.loadRoot();
    await tree.toggleExpand('r1'); // first getChildren call
    expect(tree.children['r1']).toEqual(['c1']);

    await tree.restoreFolder('c2', 'r1');

    expect(mocks.restore).toHaveBeenCalledWith('c2');
    // Second getChildren call must be a force-reload (overrides the cache).
    expect(mocks.getChildren).toHaveBeenCalledTimes(2);
    expect(tree.children['r1']).toEqual(['c1', 'c2']);
    expect(tree.error).toBeNull();
  });

  it('restoreFolder with parentId=null re-fetches root', async () => {
    mocks.getRoot
      .mockResolvedValueOnce({
        data: { items: [mockFolder('r1')] },
        meta: { requestId: 'req-root-1' },
      })
      .mockResolvedValueOnce({
        data: { items: [mockFolder('r1'), mockFolder('r2')] },
        meta: { requestId: 'req-root-2' },
      });
    mocks.restore.mockResolvedValue({
      data: { id: 'r2', foldersRestored: 1, filesRestored: 0, priorDeletedAt: null },
      meta: { requestId: 'req-restore' },
    });

    const tree = useTreeStore();
    await tree.loadRoot();
    expect(tree.rootIds).toEqual(['r1']);

    await tree.restoreFolder('r2', null);
    expect(mocks.restore).toHaveBeenCalledWith('r2');
    expect(mocks.getRoot).toHaveBeenCalledTimes(2);
    expect(tree.rootIds).toEqual(['r1', 'r2']);
  });

  it('restoreFolder surfaces API failure as a UiError and rethrows', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-root' },
    });
    mocks.restore.mockRejectedValue(new Error('nope'));

    const tree = useTreeStore();
    await tree.loadRoot();

    await expect(tree.restoreFolder('r1', null)).rejects.toThrow('nope');
    expect(tree.error?.op).toBe('restoreFolder');
    expect(tree.error?.message).toContain('nope');
  });
});
