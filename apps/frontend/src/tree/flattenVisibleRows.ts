import type { FolderNode } from '@smoothfs/shared';

export interface VisibleRow {
  id: string;
  node: FolderNode;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  /**
   * Tri-state after Phase 5:
   *   - `true`  — children fetched and non-empty, OR unknown (not yet fetched).
   *   - `false` — children fetched and empty (confirmed leaf).
   *
   * Leaves drop `aria-expanded` from their treeitem and hide the chevron so
   * assistive tech and sighted users both see a confirmed-leaf folder.
   */
  hasChildren: boolean;
  /** True only when we have positive proof the folder has zero children. */
  isLeaf: boolean;
}

export function flattenVisibleRows(
  rootIds: string[],
  nodes: Record<string, FolderNode>,
  children: Record<string, string[]>,
  expanded: Set<string>,
  loading: Set<string>,
): VisibleRow[] {
  const rows: VisibleRow[] = [];

  function traverse(id: string, depth: number) {
    const node = nodes[id];
    if (!node) return;

    const isExpanded = expanded.has(id);
    const isLoading = loading.has(id);
    const childIds = children[id];
    const isLeaf = childIds !== undefined && childIds.length === 0;

    rows.push({
      id,
      node,
      depth,
      isExpanded,
      isLoading,
      hasChildren: !isLeaf,
      isLeaf,
    });

    if (isExpanded && childIds) {
      for (const childId of childIds) {
        traverse(childId, depth + 1);
      }
    }
  }

  for (const rootId of rootIds) {
    traverse(rootId, 0);
  }

  return rows;
}
