import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import type { FolderNode, FileNode } from '@smoothfs/shared';

// Hoisted so the `useContents` mock can share mutable refs with the test body.
const state = vi.hoisted(() => {
  return {
    folders: { value: [] as FolderNode[] },
    files: { value: [] as FileNode[] },
    loading: { value: false },
    error: { value: null as unknown },
    hasMoreFolders: { value: false },
    hasMoreFiles: { value: false },
    loadingMore: { value: false },
    loadingMoreFolders: { value: false },
    loadingMoreFiles: { value: false },
    loadMoreFolders: vi.fn(),
    loadMoreFiles: vi.fn(),
  };
});

vi.mock('@/composables/useContents', () => ({
  useContents: () => state,
}));

// Stub RecycleScroller so we can render every tile synchronously in happy-dom
// (the real component needs a measured container height to compute slots).
vi.mock('vue-virtual-scroller', () => ({
  RecycleScroller: defineComponent({
    name: 'RecycleScrollerStub',
    props: {
      items: { type: Array, required: true },
      keyField: { type: String, default: 'id' },
      itemSize: { type: Number, default: 32 },
      gridItems: { type: Number, default: 1 },
    },
    emits: ['update'],
    setup(props, { slots, expose }) {
      expose({ scrollToItem: (_i: number) => undefined });
      return () =>
        h(
          'div',
          { class: 'rvs-stub' },
          (props.items as unknown[]).map((item, index) =>
            slots.default ? slots.default({ item, index }) : null,
          ),
        );
    },
  }),
}));
vi.mock('vue-virtual-scroller/dist/vue-virtual-scroller.css', () => ({}));

import ContentPanel from './ContentPanel.vue';

function iso(): string {
  return new Date('2026-04-17T00:00:00Z').toISOString();
}
function folder(id: string, name: string): FolderNode {
  return { id, parentId: null, name, createdAt: iso(), updatedAt: iso(), deletedAt: null };
}
function file(id: string, name: string): FileNode {
  return { id, folderId: 'parent', name, createdAt: iso(), updatedAt: iso(), deletedAt: null };
}

async function makeMountedPanel(): Promise<{ wrapper: ReturnType<typeof mount>; router: Router }> {
  setActivePinia(createPinia());

  state.folders = ref([folder('f1', 'Patients'), folder('f2', 'Imaging')]) as unknown as typeof state.folders;
  state.files = ref([file('x1', 'notes.txt'), file('x2', 'chart.pdf')]) as unknown as typeof state.files;
  state.loading = ref(false) as unknown as typeof state.loading;
  state.error = ref(null) as unknown as typeof state.error;
  state.hasMoreFolders = ref(false) as unknown as typeof state.hasMoreFolders;
  state.hasMoreFiles = ref(false) as unknown as typeof state.hasMoreFiles;
  state.loadingMore = ref(false) as unknown as typeof state.loadingMore;
  state.loadingMoreFolders = ref(false) as unknown as typeof state.loadingMoreFolders;
  state.loadingMoreFiles = ref(false) as unknown as typeof state.loadingMoreFiles;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/folders/:id?', name: 'folders', component: { template: '<div/>' } },
    ],
  });
  await router.push({ name: 'folders', params: { id: 'parent' } });
  await router.isReady();

  const wrapper = mount(ContentPanel, {
    global: { plugins: [router], stubs: { Teleport: true } },
  });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  setActivePinia(createPinia());
  state.folders = ref([]) as unknown as typeof state.folders;
  state.files = ref([]) as unknown as typeof state.files;
  state.loading = ref(false) as unknown as typeof state.loading;
  state.error = ref(null) as unknown as typeof state.error;
  state.hasMoreFolders = ref(false) as unknown as typeof state.hasMoreFolders;
  state.hasMoreFiles = ref(false) as unknown as typeof state.hasMoreFiles;
  state.loadingMore = ref(false) as unknown as typeof state.loadingMore;
  state.loadingMoreFolders = ref(false) as unknown as typeof state.loadingMoreFolders;
  state.loadingMoreFiles = ref(false) as unknown as typeof state.loadingMoreFiles;
});

describe('ContentPanel', () => {
  it('renders folders and files as list items with a11y attributes', async () => {
    const { wrapper } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    expect(items).toHaveLength(4);
    expect(items[0]?.attributes('data-content-item-kind')).toBe('folder');
    expect(items[2]?.attributes('data-content-item-kind')).toBe('file');

    // Only one item is tabbable at a time (roving tabindex).
    const tabbable = items.filter((i) => i.attributes('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('single-click selects the item (aria-selected + visual state)', async () => {
    const { wrapper } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    const file1 = items[2]!;
    await file1.trigger('click');
    expect(file1.attributes('aria-selected')).toBe('true');
  });

  it('double-click on folder navigates to its route', async () => {
    const { wrapper, router } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    const push = vi.spyOn(router, 'push');
    await items[0]!.trigger('dblclick');
    expect(push).toHaveBeenCalledWith({ name: 'folders', params: { id: 'f1' } });
  });

  it('double-click on file opens the info dialog with file metadata', async () => {
    const { wrapper } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    await items[2]!.trigger('dblclick');
    await flushPromises();

    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.text()).toContain('notes.txt');
    expect(dialog.text()).toContain('Text document');
  });

  it('Enter on a focused file item activates preview (keyboard parity)', async () => {
    const { wrapper } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    await items[3]!.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.text()).toContain('chart.pdf');
  });

  it('Enter on a focused folder navigates (keyboard parity)', async () => {
    const { wrapper, router } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    const push = vi.spyOn(router, 'push');
    await items[1]!.trigger('keydown', { key: 'Enter' });
    expect(push).toHaveBeenCalledWith({ name: 'folders', params: { id: 'f2' } });
  });

  it('shows a Load more button only when there is another page', async () => {
    const { wrapper } = await makeMountedPanel();
    expect(wrapper.find('[data-testid="content-load-more"]').exists()).toBe(false);

    state.hasMoreFolders.value = true;
    await flushPromises();
    expect(wrapper.find('[data-testid="content-load-more"]').exists()).toBe(true);
  });

  it('surfaces UiError metadata in the alert region', async () => {
    state.folders = ref([]) as unknown as typeof state.folders;
    state.files = ref([]) as unknown as typeof state.files;
    state.loading = ref(false) as unknown as typeof state.loading;
    state.error = ref({
      message: 'boom',
      code: 'INTERNAL',
      status: 500,
      requestId: 'req-123',
      op: 'getContents',
    }) as unknown as typeof state.error;

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/folders/:id?', name: 'folders', component: { template: '<div/>' } }],
    });
    await router.push({ name: 'folders', params: { id: 'parent' } });
    await router.isReady();
    const wrapper = mount(ContentPanel, {
      global: { plugins: [router], stubs: { Teleport: true } },
    });
    await flushPromises();

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('boom');
    expect(alert.text()).toContain('INTERNAL');
    expect(alert.text()).toContain('getContents');
    expect(alert.text()).toContain('req-123');
  });
});
