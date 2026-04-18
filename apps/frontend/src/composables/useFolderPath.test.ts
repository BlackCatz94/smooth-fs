import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { FolderNode } from '@smoothfs/shared';
import type { UiError } from '@/lib/api/error';

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
}));

vi.mock('@/lib/api/folders', () => ({
  foldersApi: { getPath: mocks.getPath },
}));

import { useFolderPath } from './useFolderPath';

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

interface HostExposed {
  path: Ref<readonly FolderNode[]>;
  loading: Ref<boolean>;
  error: Ref<UiError | null>;
}

function mountHost(selected: Ref<string | undefined>) {
  let exposed: HostExposed | null = null;
  const Host = defineComponent({
    setup() {
      const { path, loading, error } = useFolderPath(() => selected.value);
      exposed = { path, loading, error };
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get state() { return exposed!; } };
}

describe('useFolderPath', () => {
  beforeEach(() => {
    mocks.getPath.mockReset();
  });

  it('starts empty when no id is selected and never calls the API', async () => {
    const selected = ref<string | undefined>(undefined);
    const { state } = mountHost(selected);

    await nextTick();
    expect(state.path.value).toEqual([]);
    expect(state.loading.value).toBe(false);
    expect(state.error.value).toBeNull();
    expect(mocks.getPath).not.toHaveBeenCalled();
  });

  it('loads the path for the current id and exposes loading=true while in flight', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    mocks.getPath.mockImplementation(
      () => new Promise((resolve) => { resolveFn = resolve; }),
    );

    const selected = ref<string | undefined>('abc');
    const { state } = mountHost(selected);

    await nextTick();
    expect(state.loading.value).toBe(true);

    resolveFn({ data: { items: [folder('root'), folder('abc')] }, meta: { requestId: 'r' } });
    await nextTick();
    await nextTick();

    expect(state.loading.value).toBe(false);
    expect(state.path.value.map((f) => f.id)).toEqual(['root', 'abc']);
    expect(mocks.getPath).toHaveBeenCalledWith('abc');
  });

  it('clears path and error when the selection goes back to undefined', async () => {
    mocks.getPath.mockResolvedValue({
      data: { items: [folder('a')] },
      meta: { requestId: 'r' },
    });

    const selected = ref<string | undefined>('a');
    const { state } = mountHost(selected);
    await nextTick();
    await nextTick();
    expect(state.path.value.length).toBe(1);

    selected.value = undefined;
    await nextTick();
    expect(state.path.value).toEqual([]);
    expect(state.error.value).toBeNull();
  });

  it('drops a stale response if the selection changed mid-flight', async () => {
    const deferredA = defer<unknown>();
    const deferredB = defer<unknown>();

    mocks.getPath
      .mockImplementationOnce(() => deferredA.promise)
      .mockImplementationOnce(() => deferredB.promise);

    const selected = ref<string | undefined>('A');
    const { state } = mountHost(selected);
    await nextTick();

    selected.value = 'B';
    await nextTick();

    // Late response for 'A' — must NOT overwrite the in-flight 'B' fetch.
    deferredA.resolve({ data: { items: [folder('A')] }, meta: { requestId: 'rA' } });
    await nextTick();
    await nextTick();
    expect(state.path.value).toEqual([]);

    deferredB.resolve({ data: { items: [folder('B')] }, meta: { requestId: 'rB' } });
    await nextTick();
    await nextTick();
    expect(state.path.value.map((f) => f.id)).toEqual(['B']);
  });

  it('normalizes and exposes an error when the fetch fails', async () => {
    mocks.getPath.mockRejectedValue(new Error('boom'));

    const selected = ref<string | undefined>('err');
    const { state } = mountHost(selected);
    await nextTick();
    await nextTick();

    expect(state.loading.value).toBe(false);
    expect(state.path.value).toEqual([]);
    expect(state.error.value).toMatchObject({ op: 'getPath' });
  });
});

function defer<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
