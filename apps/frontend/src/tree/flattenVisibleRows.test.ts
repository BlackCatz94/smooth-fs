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
    const row = rows[0];
    expect(row?.kind).toBe('folder');
    if (row?.kind === 'folder') {
      expect(row.isLeaf).toBe(true);
      expect(row.hasChildren).toBe(false);
    }
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
    const row = rows[0];
    expect(row?.kind).toBe('folder');
    if (row?.kind === 'folder') {
      expect(row.isLeaf).toBe(false);
      expect(row.hasChildren).toBe(true);
    }
  });

  it('emits a load-more sentinel after a parent whose childrenHasMore is true', () => {
    const nodes = {
      '1': mockNode('1'),
      '1-1': mockNode('1-1'),
    };
    const rows = flattenVisibleRows(
      ['1'],
      nodes,
      { '1': ['1-1'] },
      new Set(['1']),
      new Set(),
      { '1': true },
      new Set(),
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]?.kind).toBe('folder');
    expect(rows[1]?.kind).toBe('folder');
    expect(rows[2]?.kind).toBe('load-more');
    if (rows[2]?.kind === 'load-more') {
      expect(rows[2].parentId).toBe('1');
      expect(rows[2].depth).toBe(1);
      expect(rows[2].isLoading).toBe(false);
    }
  });

  it('emits a root load-more sentinel at depth 0 when __root__ has more', () => {
    const nodes = { '1': mockNode('1') };
    const rows = flattenVisibleRows(
      ['1'],
      nodes,
      {},
      new Set<string>(),
      new Set<string>(),
      { __root__: true },
      new Set(['__root__']),
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]?.kind).toBe('load-more');
    if (rows[1]?.kind === 'load-more') {
      expect(rows[1].parentId).toBeNull();
      expect(rows[1].depth).toBe(0);
      expect(rows[1].isLoading).toBe(true);
    }
  });
});
