import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { h, defineComponent } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import type { FolderNode } from '@smoothfs/shared';

const state = vi.hoisted(() => ({
  childrenByParent: new Map<string | null, FolderNode[]>(),
}));

const folderApiMocks = vi.hoisted(() => ({
  getRoot: vi.fn(),
  getChildren: vi.fn(),
  getPath: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('@/lib/api/folders', () => ({
  foldersApi: folderApiMocks,
}));

// Stub RecycleScroller so we can render all items synchronously in tests.
vi.mock('vue-virtual-scroller', () => {
  return {
    RecycleScroller: defineComponent({
      name: 'RecycleScrollerStub',
      props: {
        items: { type: Array, required: true },
        keyField: { type: String, default: 'id' },
        itemSize: { type: Number, default: 32 },
      },
      setup(props, { slots, expose }) {
        expose({ scrollToItem: (_i: number) => undefined });
        return () =>
          h(
            'div',
            { class: 'rvs-stub' },
            (props.items as unknown[]).map((item) =>
              slots.default ? slots.default({ item }) : null,
            ),
          );
      },
    }),
  };
});
vi.mock('vue-virtual-scroller/dist/vue-virtual-scroller.css', () => ({}));

import FolderTree from './FolderTree.vue';

function iso(): string {
  return new Date('2026-04-17T00:00:00Z').toISOString();
}
function mkFolder(id: string, parentId: string | null, name: string): FolderNode {
  return {
    id,
    parentId,
    name,
    createdAt: iso(),
    updatedAt: iso(),
    deletedAt: null,
    // Conservative default: tree-level tests pre-date the `hasChildFolders`
    // optimisation and rely on the legacy "unknown → show chevron" behaviour.
    // Setting `true` preserves those scenarios; focused leaf tests opt in
    // explicitly.
    hasChildFolders: true,
  };
}

function resetFolderApiMocks(): void {
  folderApiMocks.getRoot.mockReset();
  folderApiMocks.getRoot.mockImplementation(async () => {
    const items = state.childrenByParent.get(null) ?? [];
    return {
      data: { items },
      meta: { requestId: 'req-root', cursor: null, hasMore: false },
    };
  });
  folderApiMocks.getChildren.mockReset();
  folderApiMocks.getChildren.mockImplementation(async (parentId: string) => {
    const items = state.childrenByParent.get(parentId) ?? [];
    return {
      data: { items },
      meta: { requestId: `req-${parentId}`, cursor: null, hasMore: false },
    };
  });
  folderApiMocks.getPath.mockReset();
  folderApiMocks.getPath.mockImplementation(async (id: string) => ({
    data: { items: [{ id }] },
    meta: { requestId: `req-${id}` },
  }));
  folderApiMocks.softDelete.mockReset();
  folderApiMocks.softDelete.mockImplementation(async (_id: string) => undefined);
  folderApiMocks.restore.mockReset();
  folderApiMocks.restore.mockImplementation(async (id: string) => ({
    data: { id, foldersRestored: 1, filesRestored: 0, priorDeletedAt: null },
    meta: { requestId: `req-restore-${id}` },
  }));
}

async function makeTree(): Promise<VueWrapper> {
  setActivePinia(createPinia());
  resetFolderApiMocks();

  state.childrenByParent.clear();
  state.childrenByParent.set(null, [mkFolder('r1', null, 'Root A'), mkFolder('r2', null, 'Root B')]);
  state.childrenByParent.set('r1', [mkFolder('r1c1', 'r1', 'Child A1'), mkFolder('r1c2', 'r1', 'Child A2')]);
  state.childrenByParent.set('r2', []);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/folders/:id?', name: 'folders', component: { template: '<div/>' } }],
  });
  await router.push({ name: 'folders' });
  await router.isReady();

  // happy-dom: give requestAnimationFrame a trivial impl.
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0);
      return 0;
    }) as typeof globalThis.requestAnimationFrame;
  }

  const wrapper = mount(FolderTree, {
    global: { plugins: [router] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  localStorage.clear();
});

describe('FolderTree', () => {
  it('renders loaded root folders as treeitems and auto-expands them on first load', async () => {
    // First-load UX (new): with nothing persisted in localStorage, both roots
    // auto-expand so the user sees their children immediately. Root A has 2
    // children, Root B has none → 2 roots + 2 grandchildren = 4 rows.
    const wrapper = await makeTree();
    expect(wrapper.get('[role="tree"]').attributes('aria-label')).toBe('Folders');
    const items = wrapper.findAll('[role="treeitem"]');
    expect(items).toHaveLength(4);
    const names = items.map((i) => i.text());
    expect(names[0]).toContain('Root A');
    expect(names.some((n) => n.includes('Child A1'))).toBe(true);
    expect(names.some((n) => n.includes('Child A2'))).toBe(true);
    expect(names.some((n) => n.includes('Root B'))).toBe(true);
    wrapper.unmount();
  });

  it('does NOT auto-expand when a persisted expanded set exists (respects user intent)', async () => {
    setActivePinia(createPinia());
    resetFolderApiMocks();
    state.childrenByParent.clear();
    state.childrenByParent.set(null, [
      mkFolder('r1', null, 'Root A'),
      mkFolder('r2', null, 'Root B'),
    ]);
    state.childrenByParent.set('r1', [mkFolder('r1c1', 'r1', 'Child A1')]);
    // Give Root B children too — auto-expand would surface "Child B1",
    // rehydration with only `['r1']` persisted must NOT.
    state.childrenByParent.set('r2', [mkFolder('r2c1', 'r2', 'Child B1')]);

    localStorage.setItem(
      'smoothfs.tree.state.v1',
      JSON.stringify({ version: 1, selectedId: null, expanded: ['r1'] }),
    );

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/folders/:id?', name: 'folders', component: { template: '<div/>' } }],
    });
    await router.push({ name: 'folders' });
    await router.isReady();

    if (typeof globalThis.requestAnimationFrame !== 'function') {
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        setTimeout(() => cb(performance.now()), 0);
        return 0;
      }) as typeof globalThis.requestAnimationFrame;
    }

    const wrapper = mount(FolderTree, {
      global: { plugins: [router] },
      attachTo: document.body,
    });
    await flushPromises();

    const names = wrapper
      .findAll('[role="treeitem"]')
      .map((i) => i.text());
    // Root A is in the persisted set → its child IS visible.
    expect(names.some((n) => n.includes('Child A1'))).toBe(true);
    // Root B is NOT in the persisted set and the auto-expand path is
    // disabled when persisted state exists → its child must stay hidden.
    expect(names.some((n) => n.includes('Child B1'))).toBe(false);

    wrapper.unmount();
  });

  it('roving tabindex: only the focused root is tabbable after load', async () => {
    const wrapper = await makeTree();
    const items = wrapper.findAll('[role="treeitem"]');
    const tabbable = items.filter((i) => i.attributes('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]?.text()).toContain('Root A');
    wrapper.unmount();
  });

  it('ArrowDown moves focus to the next visible row', async () => {
    const wrapper = await makeTree();
    const tree = wrapper.get('[role="tree"]');
    await tree.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    const items = wrapper.findAll('[role="treeitem"]');
    const focused = items.find((i) => i.attributes('tabindex') === '0');
    // Root A is auto-expanded so the next visible row is its first child.
    expect(focused?.text()).toContain('Child A1');
    wrapper.unmount();
  });

  it('ArrowRight on an already-expanded row is a no-op (auto-expand state)', async () => {
    const wrapper = await makeTree();
    const tree = wrapper.get('[role="tree"]');
    // Root A is already expanded by auto-expand; ArrowRight must not duplicate
    // children or break the row count.
    await tree.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    const items = wrapper.findAll('[role="treeitem"]');
    expect(items).toHaveLength(4);
    const names = items.map((i) => i.text());
    expect(names.filter((n) => n.includes('Child A1'))).toHaveLength(1);
    expect(names.filter((n) => n.includes('Child A2'))).toHaveLength(1);
    wrapper.unmount();
  });

  it('Enter selects focused row and updates the route', async () => {
    const wrapper = await makeTree();
    const tree = wrapper.get('[role="tree"]');
    await tree.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const router = wrapper.vm.$router;
    expect(router.currentRoute.value.params.id).toBe('r1');
    wrapper.unmount();
  });

  it('Delete triggers an undo toast that restores the folder on activation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    const wrapper = await makeTree();
    const { useToastStore } = await import('@/stores/toasts');
    const toasts = useToastStore();

    const tree = wrapper.get('[role="tree"]');
    // Focus is on Root A after load. Delete key triggers confirm + softDelete.
    await tree.trigger('keydown', { key: 'Delete' });
    await flushPromises();

    expect(folderApiMocks.softDelete).toHaveBeenCalledWith('r1');
    expect(toasts.items).toHaveLength(1);
    const t = toasts.items[0]!;
    expect(t.message).toContain('Root A');
    expect(t.action?.label).toBe('Undo');

    await toasts.activate(t.id);
    expect(folderApiMocks.restore).toHaveBeenCalledWith('r1');
    // parentId is null for a root-level folder → store falls back to loadRoot.
    expect(folderApiMocks.getRoot).toHaveBeenCalledTimes(2);
    expect(toasts.items).toHaveLength(0);

    confirmSpy.mockRestore();
    wrapper.unmount();
  });
});
