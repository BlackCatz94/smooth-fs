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

  it('paginates child fetches via cursor until hasMore=false', async () => {
    mocks.getRoot.mockResolvedValue({
      data: { items: [mockFolder('r1')] },
      meta: { requestId: 'req-root', hasMore: false, cursor: null },
    });
    // First page: hasMore=true + cursor -> triggers a second call.
    // Second page: hasMore=false -> loop exits.
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

    expect(mocks.getChildren).toHaveBeenCalledTimes(2);
    // Second call must forward the cursor from the first page.
    expect(mocks.getChildren.mock.calls[1]?.[1]).toMatchObject({ cursor: 'cur-1' });
    expect(tree.children['r1']).toEqual(['c1', 'c2', 'c3']);
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
});
