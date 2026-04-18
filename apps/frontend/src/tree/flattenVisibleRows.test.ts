import { describe, it, expect } from 'vitest';
import { flattenVisibleRows } from './flattenVisibleRows';
import type { FolderNode } from '@smoothfs/shared';

describe('flattenVisibleRows', () => {
  const mockNode = (id: string): FolderNode => ({
    id,
    name: `Folder ${id}`,
    parentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  });

  it('flattens root nodes correctly', () => {
    const nodes = {
      '1': mockNode('1'),
      '2': mockNode('2'),
    };
    const rootIds = ['1', '2'];
    const children = {};
    const expanded = new Set<string>();
    const loading = new Set<string>();

    const rows = flattenVisibleRows(rootIds, nodes, children, expanded, loading);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe('1');
    expect(rows[0]?.depth).toBe(0);
    expect(rows[1]?.id).toBe('2');
    expect(rows[1]?.depth).toBe(0);
  });

  it('includes children of expanded nodes', () => {
    const nodes = {
      '1': mockNode('1'),
      '1-1': mockNode('1-1'),
      '1-2': mockNode('1-2'),
      '2': mockNode('2'),
    };
    const rootIds = ['1', '2'];
    const children = {
      '1': ['1-1', '1-2'],
    };
    const expanded = new Set(['1']);
    const loading = new Set<string>();

    const rows = flattenVisibleRows(rootIds, nodes, children, expanded, loading);

    expect(rows).toHaveLength(4);
    expect(rows[0]?.id).toBe('1');
    expect(rows[1]?.id).toBe('1-1');
    expect(rows[1]?.depth).toBe(1);
    expect(rows[2]?.id).toBe('1-2');
    expect(rows[2]?.depth).toBe(1);
    expect(rows[3]?.id).toBe('2');
  });

  it('does not include children of unexpanded nodes', () => {
    const nodes = {
      '1': mockNode('1'),
      '1-1': mockNode('1-1'),
      '2': mockNode('2'),
    };
    const rootIds = ['1', '2'];
    const children = {
      '1': ['1-1'],
    };
    const expanded = new Set<string>();
    const loading = new Set<string>();

    const rows = flattenVisibleRows(rootIds, nodes, children, expanded, loading);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe('1');
    expect(rows[1]?.id).toBe('2');
  });

  it('marks a folder as confirmed leaf when children is a known-empty array', () => {
    const nodes = { '1': mockNode('1') };
    const rootIds = ['1'];
    const children = { '1': [] as string[] };
    const rows = flattenVisibleRows(
      rootIds,
      nodes,
      children,
      new Set<string>(),
      new Set<string>(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isLeaf).toBe(true);
    expect(rows[0]?.hasChildren).toBe(false);
  });

  it('treats unknown children as potentially non-empty (not a leaf)', () => {
    const nodes = { '1': mockNode('1') };
    const rows = flattenVisibleRows(
      ['1'],
      nodes,
      {},
      new Set<string>(),
      new Set<string>(),
    );
    expect(rows[0]?.isLeaf).toBe(false);
    expect(rows[0]?.hasChildren).toBe(true);
  });
});
