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
    removeFolder: vi.fn(),
    removeFile: vi.fn(),
    refresh: vi.fn(async () => undefined),
  };
});

vi.mock('@/composables/useContents', () => ({
  useContents: () => state,
}));

// Mock the files API so the delete-button test path is hermetic.
const filesApiMock = vi.hoisted(() => ({
  softDelete: vi.fn(async (_id: string) => undefined),
  restore: vi.fn(async (_id: string) => ({
    data: { id: _id, priorDeletedAt: null },
    meta: { requestId: 'req-restore' },
  })),
}));
vi.mock('@/lib/api/files', () => ({
  filesApi: filesApiMock,
}));

// Mock the tree store so folder soft-delete doesn't try to hit the network.
const treeStoreMock = vi.hoisted(() => ({
  softDelete: vi.fn(async (_id: string) => undefined),
  restoreFolder: vi.fn(async (_id: string, _parentId: string | null) => undefined),
}));
vi.mock('@/tree/tree.store', () => ({
  useTreeStore: () => treeStoreMock,
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
  return {
    id,
    parentId: null,
    name,
    createdAt: iso(),
    updatedAt: iso(),
    deletedAt: null,
    hasChildFolders: false,
  };
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
  state.removeFolder.mockReset();
  state.removeFile.mockReset();
  state.refresh.mockReset();
  state.refresh.mockImplementation(async () => undefined);
  filesApiMock.softDelete.mockReset();
  filesApiMock.softDelete.mockImplementation(async (_id: string) => undefined);
  filesApiMock.restore.mockReset();
  filesApiMock.restore.mockImplementation(async (id: string) => ({
    data: { id, priorDeletedAt: null },
    meta: { requestId: 'req-restore' },
  }));
  treeStoreMock.softDelete.mockReset();
  treeStoreMock.softDelete.mockImplementation(async (_id: string) => undefined);
  treeStoreMock.restoreFolder.mockReset();
  treeStoreMock.restoreFolder.mockImplementation(
    async (_id: string, _parentId: string | null) => undefined,
  );
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

  it('rapid double-click on folder navigates to its route (recycler-safe)', async () => {
    // Two consecutive `click` events under the rapid-click window. We no
    // longer rely on native `dblclick` because vue-virtual-scroller recycles
    // tile DOM nodes between rapid clicks — see the `RAPID_CLICK_MS` block
    // in `ContentPanel.vue` for the full rationale.
    const { wrapper, router } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    const push = vi.spyOn(router, 'push');
    await items[0]!.trigger('click');
    await items[0]!.trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'folders', params: { id: 'f1' } });
  });

  it('rapid double-click on file opens the info dialog with file metadata', async () => {
    const { wrapper } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    await items[2]!.trigger('click');
    await items[2]!.trigger('click');
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

  it('Delete button is disabled with no selection and enabled for folders or files', async () => {
    const { wrapper } = await makeMountedPanel();
    const btn = wrapper.get('[data-testid="content-delete"]');
    expect(btn.attributes('disabled')).toBeDefined();

    // Select the first folder.
    const items = wrapper.findAll('[role="listitem"]');
    await items[0]!.trigger('click');
    expect(btn.attributes('disabled')).toBeUndefined();

    // Select a file — must also enable the button now (was a regression: the
    // previous build hard-disabled Delete for files because the endpoint
    // didn't exist yet; with `DELETE /api/v1/files/:id` it does).
    await items[2]!.trigger('click');
    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('clicking Delete on a selected file calls filesApi.softDelete + removeFile', async () => {
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);

    const { wrapper } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    // Select the first file (`x1`, "notes.txt").
    await items[2]!.trigger('click');
    await wrapper.get('[data-testid="content-delete"]').trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(filesApiMock.softDelete).toHaveBeenCalledWith('x1');
    expect(state.removeFile).toHaveBeenCalledWith('x1');
    // Folder soft-delete must NOT have been touched for a file delete.
    expect(treeStoreMock.softDelete).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('clicking Delete on a selected folder still calls treeStore.softDelete + removeFolder', async () => {
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);

    const { wrapper } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    await items[0]!.trigger('click');
    await wrapper.get('[data-testid="content-delete"]').trigger('click');
    await flushPromises();

    expect(treeStoreMock.softDelete).toHaveBeenCalledWith('f1');
    expect(state.removeFolder).toHaveBeenCalledWith('f1');
    expect(filesApiMock.softDelete).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('surfaces a delete failure inline and leaves the row in the list', async () => {
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);
    filesApiMock.softDelete.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'INTERNAL', status: 500 }),
    );

    const { wrapper } = await makeMountedPanel();
    const items = wrapper.findAll('[role="listitem"]');
    await items[2]!.trigger('click');
    await wrapper.get('[data-testid="content-delete"]').trigger('click');
    await flushPromises();

    const alert = wrapper.get('[data-testid="content-delete-error"]');
    expect(alert.text()).toContain('boom');
    // removeFile was NOT called because the API rejected.
    expect(state.removeFile).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('shows an undo toast after a successful file delete and restores on activation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    const { wrapper } = await makeMountedPanel();
    // Need the toast store *inside* the component's pinia, which is the
    // currently-active one.
    const { useToastStore } = await import('@/stores/toasts');
    const toasts = useToastStore();

    const items = wrapper.findAll('[role="listitem"]');
    await items[2]!.trigger('click'); // select x1 (notes.txt)
    await wrapper.get('[data-testid="content-delete"]').trigger('click');
    await flushPromises();

    expect(toasts.items).toHaveLength(1);
    const t = toasts.items[0]!;
    expect(t.message).toContain('notes.txt');
    expect(t.action?.label).toBe('Undo');

    await toasts.activate(t.id);
    expect(filesApiMock.restore).toHaveBeenCalledWith('x1');
    expect(state.refresh).toHaveBeenCalled();
    expect(toasts.items).toHaveLength(0);

    confirmSpy.mockRestore();
  });

  it('shows an undo toast after a successful folder delete and restores via tree.restoreFolder', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    const { wrapper } = await makeMountedPanel();
    const { useToastStore } = await import('@/stores/toasts');
    const toasts = useToastStore();

    const items = wrapper.findAll('[role="listitem"]');
    await items[0]!.trigger('click'); // select f1 (Patients folder)
    await wrapper.get('[data-testid="content-delete"]').trigger('click');
    await flushPromises();

    expect(toasts.items).toHaveLength(1);
    const t = toasts.items[0]!;
    expect(t.message).toContain('Patients');

    await toasts.activate(t.id);
    // Right panel was viewing route id 'parent', so that's the parent for restore.
    expect(treeStoreMock.restoreFolder).toHaveBeenCalledWith('f1', 'parent');
    expect(state.refresh).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('does not show a toast when the delete itself fails', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    filesApiMock.softDelete.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'INTERNAL', status: 500 }),
    );
    const { wrapper } = await makeMountedPanel();
    const { useToastStore } = await import('@/stores/toasts');
    const toasts = useToastStore();

    const items = wrapper.findAll('[role="listitem"]');
    await items[2]!.trigger('click');
    await wrapper.get('[data-testid="content-delete"]').trigger('click');
    await flushPromises();

    // Failure is surfaced inline, not as a toast.
    expect(toasts.items).toHaveLength(0);
    confirmSpy.mockRestore();
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
