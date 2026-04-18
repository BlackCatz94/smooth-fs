import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { FolderNode } from '@smoothfs/shared';
import Breadcrumb from './Breadcrumb.vue';

const pushSpy = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushSpy }),
}));

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

describe('Breadcrumb', () => {
  it('always renders the Root home segment and marks it current when path is empty', () => {
    const wrapper = mount(Breadcrumb, {
      props: { path: [], loading: false },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.text()).toContain('Root');
    expect(buttons[0]!.attributes('aria-current')).toBe('page');
  });

  it('renders a button per path segment and marks the last one as aria-current=page', () => {
    const path = [folder('a', 'Docs'), folder('b', 'Clients'), folder('c', 'Acme')];
    const wrapper = mount(Breadcrumb, {
      props: { path, loading: false },
    });

    const buttons = wrapper.findAll('button');
    // 1 Root + 3 segments
    expect(buttons).toHaveLength(4);
    expect(buttons[1]!.text()).toBe('Docs');
    expect(buttons[2]!.text()).toBe('Clients');
    expect(buttons[3]!.text()).toBe('Acme');

    // Only the final segment is aria-current=page when path is non-empty.
    expect(buttons[0]!.attributes('aria-current')).toBeUndefined();
    expect(buttons[1]!.attributes('aria-current')).toBeUndefined();
    expect(buttons[2]!.attributes('aria-current')).toBeUndefined();
    expect(buttons[3]!.attributes('aria-current')).toBe('page');
  });

  it('clicking a segment pushes the route with its id; Root pushes name only', async () => {
    pushSpy.mockClear();
    const path = [folder('a', 'Docs'), folder('b', 'Clients')];
    const wrapper = mount(Breadcrumb, {
      props: { path, loading: false },
    });
    const buttons = wrapper.findAll('button');

    await buttons[1]!.trigger('click');
    expect(pushSpy).toHaveBeenLastCalledWith({ name: 'folders', params: { id: 'a' } });

    await buttons[2]!.trigger('click');
    expect(pushSpy).toHaveBeenLastCalledWith({ name: 'folders', params: { id: 'b' } });

    await buttons[0]!.trigger('click');
    // Root navigates without params.
    expect(pushSpy).toHaveBeenLastCalledWith({ name: 'folders' });
  });

  it('shows a Loading... hint only when loading AND path is still empty', () => {
    const loading = mount(Breadcrumb, {
      props: { path: [], loading: true },
    });
    expect(loading.text()).toContain('Loading...');

    const loaded = mount(Breadcrumb, {
      props: { path: [folder('a')], loading: true },
    });
    // Once at least one segment is available the spinner would be noise.
    expect(loaded.text()).not.toContain('Loading...');
  });
});
