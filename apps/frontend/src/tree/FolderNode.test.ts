import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import FolderNode from './FolderNode.vue';
import type { VisibleRow } from './flattenVisibleRows';
import type { FolderNode as FolderNodeDto } from '@smoothfs/shared';

function makeRow(overrides: Partial<VisibleRow> = {}): VisibleRow {
  const node: FolderNodeDto = {
    id: 'n1',
    parentId: null,
    name: 'Patients',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
  return {
    id: 'n1',
    node,
    depth: 0,
    isExpanded: false,
    isLoading: false,
    hasChildren: true,
    isLeaf: false,
    ...overrides,
  };
}

describe('FolderNode a11y', () => {
  it('exposes treeitem role, aria-level, aria-selected, aria-expanded', () => {
    const wrapper = mount(FolderNode, {
      props: {
        row: makeRow({ depth: 2, isExpanded: true }),
        isSelected: true,
        isFocused: false,
      },
    });

    const item = wrapper.get('[role="treeitem"]');
    expect(item.attributes('aria-level')).toBe('3');
    expect(item.attributes('aria-selected')).toBe('true');
    expect(item.attributes('aria-expanded')).toBe('true');
  });

  it('omits aria-expanded for confirmed leaves and hides the chevron button', () => {
    const wrapper = mount(FolderNode, {
      props: {
        row: makeRow({ isLeaf: true, hasChildren: false }),
        isSelected: false,
        isFocused: false,
      },
    });

    const item = wrapper.get('[role="treeitem"]');
    expect(item.attributes('aria-expanded')).toBeUndefined();
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('uses roving tabindex: 0 when focused, -1 otherwise', async () => {
    const wrapper = mount(FolderNode, {
      props: { row: makeRow(), isSelected: false, isFocused: false },
    });
    expect(wrapper.get('[role="treeitem"]').attributes('tabindex')).toBe('-1');

    await wrapper.setProps({ isFocused: true });
    expect(wrapper.get('[role="treeitem"]').attributes('tabindex')).toBe('0');
  });

  it('click on chevron emits toggle (and does not emit select)', async () => {
    const wrapper = mount(FolderNode, {
      props: { row: makeRow(), isSelected: false, isFocused: true },
    });
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['n1']);
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('click on row body emits select', async () => {
    const wrapper = mount(FolderNode, {
      props: { row: makeRow(), isSelected: false, isFocused: true },
    });
    await wrapper.get('[role="treeitem"]').trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual(['n1']);
  });

  it('applies depth-based indentation', () => {
    const wrapper = mount(FolderNode, {
      props: { row: makeRow({ depth: 3 }), isSelected: false, isFocused: false },
    });
    const style = wrapper.get('[role="treeitem"]').attributes('style') ?? '';
    expect(style).toContain('padding-left');
    // depth * 1.5rem + 0.5rem = 5rem at depth 3
    expect(style).toMatch(/5rem/);
  });
});
