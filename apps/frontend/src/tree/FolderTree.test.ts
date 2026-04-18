import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { h, defineComponent } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import type { FolderNode } from '@smoothfs/shared';

const state = vi.hoisted(() => ({
  childrenByParent: new Map<string | null, FolderNode[]>(),
}));

vi.mock('@/lib/api/folders', () => ({
  foldersApi: {
    getRoot: vi.fn(async () => {
      const items = state.childrenByParent.get(null) ?? [];
      return {
        data: { items },
        meta: { requestId: 'req-root', cursor: null, hasMore: false },
      };
    }),
    getChildren: vi.fn(async (parentId: string) => {
      const items = state.childrenByParent.get(parentId) ?? [];
      return {
        data: { items },
        meta: { requestId: `req-${parentId}`, cursor: null, hasMore: false },
      };
    }),
    getPath: vi.fn(async (id: string) => {
      return {
        data: { items: [{ id }] },
        meta: { requestId: `req-${id}` },
      };
    }),
  },
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
  return { id, parentId, name, createdAt: iso(), updatedAt: iso(), deletedAt: null };
}

async function makeTree(): Promise<VueWrapper> {
  setActivePinia(createPinia());

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
  it('renders loaded root folders as treeitems inside a tree', async () => {
    const wrapper = await makeTree();
    expect(wrapper.get('[role="tree"]').attributes('aria-label')).toBe('Folders');
    const items = wrapper.findAll('[role="treeitem"]');
    expect(items).toHaveLength(2);
    expect(items[0]?.text()).toContain('Root A');
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
    expect(focused?.text()).toContain('Root B');
    wrapper.unmount();
  });

  it('ArrowRight on collapsed row expands and loads children', async () => {
    const wrapper = await makeTree();
    const tree = wrapper.get('[role="tree"]');
    // First row (Root A) is focused; ArrowRight triggers expand.
    await tree.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    const items = wrapper.findAll('[role="treeitem"]');
    // Expect 2 roots + 2 children of Root A.
    expect(items.length).toBeGreaterThanOrEqual(4);
    const names = items.map((i) => i.text());
    expect(names.some((n) => n.includes('Child A1'))).toBe(true);
    expect(names.some((n) => n.includes('Child A2'))).toBe(true);
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
});
