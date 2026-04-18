import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref, type ComputedRef } from 'vue';
import { mount } from '@vue/test-utils';
import type { FolderNode, FileNode } from '@smoothfs/shared';
import type { UiError } from '@/lib/api/error';
import { ApiClientError } from '@/lib/api/client';

const mocks = vi.hoisted(() => ({
  getContents: vi.fn(),
}));

vi.mock('@/lib/api/folders', () => ({
  foldersApi: { getContents: mocks.getContents },
}));

import { useContents, type UseContentsReturn } from './useContents';

function folder(id: string, name = `F-${id}`): FolderNode {
  return {
    id,
    parentId: null,
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    hasChildFolders: false,
  };
}

function file(id: string, folderId = 'parent'): FileNode {
  return {
    id,
    folderId,
    name: `file-${id}.txt`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function contentsResponse(opts: {
  folders?: FolderNode[];
  files?: FileNode[];
  foldersCursor?: string | null;
  filesCursor?: string | null;
  hasMoreFolders?: boolean;
  hasMoreFiles?: boolean;
} = {}) {
  return {
    data: {
      folders: {
        items: opts.folders ?? [],
        nextCursor: opts.foldersCursor ?? null,
        hasMore: opts.hasMoreFolders ?? false,
      },
      files: {
        items: opts.files ?? [],
        nextCursor: opts.filesCursor ?? null,
        hasMore: opts.hasMoreFiles ?? false,
      },
    },
    meta: { requestId: 'req-1' },
  };
}

interface HostExposed extends UseContentsReturn {
  folders: Ref<FolderNode[]>;
  files: Ref<FileNode[]>;
  loading: Ref<boolean>;
  loadingMore: ComputedRef<boolean>;
  error: Ref<UiError | null>;
}

function mountHost(selected: Ref<string | undefined>) {
  let exposed: HostExposed | null = null;
  const Host = defineComponent({
    setup() {
      const api = useContents(() => selected.value);
      exposed = api as HostExposed;
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get c() { return exposed!; } };
}

function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await nextTick();
  await nextTick();
}

describe('useContents', () => {
  beforeEach(() => {
    mocks.getContents.mockReset();
  });

  it('clears state when no id is selected and does not call the API', async () => {
    const selected = ref<string | undefined>(undefined);
    const { c } = mountHost(selected);

    await flush();
    expect(c.folders.value).toEqual([]);
    expect(c.files.value).toEqual([]);
    expect(c.hasMoreFolders.value).toBe(false);
    expect(c.hasMoreFiles.value).toBe(false);
    expect(c.loading.value).toBe(false);
    expect(c.error.value).toBeNull();
    expect(mocks.getContents).not.toHaveBeenCalled();
  });

  it('fetches initial folders + files and populates cursor metadata', async () => {
    mocks.getContents.mockResolvedValue(
      contentsResponse({
        folders: [folder('a'), folder('b')],
        files: [file('1'), file('2')],
        foldersCursor: 'c-folders',
        filesCursor: 'c-files',
        hasMoreFolders: true,
        hasMoreFiles: true,
      }),
    );

    const selected = ref<string | undefined>('root');
    const { c } = mountHost(selected);
    await flush();

    expect(c.folders.value.map((f) => f.id)).toEqual(['a', 'b']);
    expect(c.files.value.map((f) => f.id)).toEqual(['1', '2']);
    expect(c.hasMoreFolders.value).toBe(true);
    expect(c.hasMoreFiles.value).toBe(true);
    expect(c.loading.value).toBe(false);
  });

  it('loadMoreFolders appends a second page and carries the next cursor', async () => {
    mocks.getContents.mockResolvedValueOnce(
      contentsResponse({
        folders: [folder('a')],
        foldersCursor: 'cursor-1',
        hasMoreFolders: true,
      }),
    );

    const selected = ref<string | undefined>('root');
    const { c } = mountHost(selected);
    await flush();

    mocks.getContents.mockResolvedValueOnce(
      contentsResponse({
        folders: [folder('b'), folder('c')],
        foldersCursor: null,
        hasMoreFolders: false,
      }),
    );
    await c.loadMoreFolders();
    await flush();

    expect(c.folders.value.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(c.hasMoreFolders.value).toBe(false);
    // Second call uses the cursor from the first page.
    const secondArgs = mocks.getContents.mock.calls[1];
    expect(secondArgs?.[0]).toBe('root');
    expect(secondArgs?.[1]).toMatchObject({ foldersCursor: 'cursor-1', filesCursor: null });
  });

  it('loadMoreFiles appends a second file page symmetrically', async () => {
    mocks.getContents.mockResolvedValueOnce(
      contentsResponse({
        files: [file('1')],
        filesCursor: 'fcur-1',
        hasMoreFiles: true,
      }),
    );

    const selected = ref<string | undefined>('root');
    const { c } = mountHost(selected);
    await flush();

    mocks.getContents.mockResolvedValueOnce(
      contentsResponse({
        files: [file('2'), file('3')],
        filesCursor: null,
        hasMoreFiles: false,
      }),
    );
    await c.loadMoreFiles();
    await flush();

    expect(c.files.value.map((f) => f.id)).toEqual(['1', '2', '3']);
    expect(c.hasMoreFiles.value).toBe(false);
    expect(mocks.getContents.mock.calls[1]?.[1]).toMatchObject({
      foldersCursor: null,
      filesCursor: 'fcur-1',
    });
  });

  it('loadMoreFolders is a no-op when there is nothing more to fetch', async () => {
    mocks.getContents.mockResolvedValueOnce(
      contentsResponse({ folders: [folder('a')], hasMoreFolders: false }),
    );

    const selected = ref<string | undefined>('root');
    const { c } = mountHost(selected);
    await flush();

    await c.loadMoreFolders();
    await c.loadMoreFiles();
    expect(mocks.getContents).toHaveBeenCalledTimes(1);
  });

  it('normalizes errors from the initial fetch and empties the result state', async () => {
    mocks.getContents.mockRejectedValue(new Error('network down'));

    const selected = ref<string | undefined>('root');
    const { c } = mountHost(selected);
    await flush();

    expect(c.error.value).toMatchObject({ op: 'getContents' });
    expect(c.folders.value).toEqual([]);
    expect(c.files.value).toEqual([]);
    expect(c.loading.value).toBe(false);
  });

  it('drops a stale initial response when the selection changes mid-flight', async () => {
    const first = defer<unknown>();
    const second = defer<unknown>();
    mocks.getContents
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const selected = ref<string | undefined>('A');
    const { c } = mountHost(selected);
    await nextTick();

    selected.value = 'B';
    await nextTick();

    // Late resolution for A must not overwrite B.
    first.resolve(contentsResponse({ folders: [folder('from-A')] }));
    await flush();
    expect(c.folders.value).toEqual([]);

    second.resolve(contentsResponse({ folders: [folder('from-B')] }));
    await flush();
    expect(c.folders.value.map((f) => f.id)).toEqual(['from-B']);
  });

  it('silently ignores AbortError from the cancelled in-flight fetch', async () => {
    const first = defer<unknown>();
    mocks.getContents.mockImplementationOnce(() => first.promise);
    mocks.getContents.mockResolvedValueOnce(
      contentsResponse({ folders: [folder('new')] }),
    );

    const selected = ref<string | undefined>('A');
    const { c } = mountHost(selected);
    await nextTick();

    selected.value = 'B';
    await flush();

    // The first fetch was aborted; simulate the rejection that an aborted
    // `ApiClientError` would propagate.
    first.reject(new ApiClientError('Request aborted', 'ABORTED', 0, 'r'));
    await flush();

    // Error from the abort must NOT leak into state.
    expect(c.error.value).toBeNull();
    expect(c.folders.value.map((f) => f.id)).toEqual(['new']);
  });

  it('refresh() re-runs the initial fetch for the current id', async () => {
    mocks.getContents.mockResolvedValueOnce(contentsResponse({ folders: [folder('x1')] }));

    const selected = ref<string | undefined>('root');
    const { c } = mountHost(selected);
    await flush();
    expect(c.folders.value.map((f) => f.id)).toEqual(['x1']);

    mocks.getContents.mockResolvedValueOnce(contentsResponse({ folders: [folder('x2')] }));
    await c.refresh();
    await flush();
    expect(c.folders.value.map((f) => f.id)).toEqual(['x2']);
    expect(mocks.getContents).toHaveBeenCalledTimes(2);
  });

  it('removeFolder / removeFile prune matching rows only', async () => {
    mocks.getContents.mockResolvedValueOnce(
      contentsResponse({
        folders: [folder('a'), folder('b')],
        files: [file('1'), file('2')],
      }),
    );

    const selected = ref<string | undefined>('root');
    const { c } = mountHost(selected);
    await flush();

    c.removeFolder('a');
    expect(c.folders.value.map((f) => f.id)).toEqual(['b']);

    // Unknown id is a no-op, not an error.
    const before = c.folders.value;
    c.removeFolder('ghost');
    expect(c.folders.value).toBe(before);

    c.removeFile('1');
    expect(c.files.value.map((f) => f.id)).toEqual(['2']);
  });
});
