import type { FolderNode } from '@smoothfs/shared';

/**
 * A renderable row in the folder tree. We expose two kinds:
 *
 *   - `folder` — the normal folder treeitem.
 *   - `load-more` — a synthetic sentinel inserted at the tail of a sibling
 *     list when the server reports `hasMore=true`. Clicking / activating it
 *     calls `loadMoreChildren(parentId)` (or `loadMoreRoot()` when
 *     `parentId === null`). We keep this row OUTSIDE the regular treeitem
 *     set (`role="none"` at the sentinel) so screen readers don't announce
 *     it as a folder.
 */
export type TreeRow = VisibleRow | LoadMoreRow;

export interface VisibleRow {
  readonly kind: 'folder';
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

export interface LoadMoreRow {
  readonly kind: 'load-more';
  /** Synthetic id so vue-virtual-scroller's key lookup stays stable. */
  id: string;
  /** `null` means "load more root folders". */
  parentId: string | null;
  /** Same depth as the siblings above it. */
  depth: number;
  /** True while the next page is in flight. */
  isLoading: boolean;
}

export interface FlattenInput {
  readonly rootIds: readonly string[];
  readonly nodes: Readonly<Record<string, FolderNode>>;
  readonly children: Readonly<Record<string, readonly string[]>>;
  readonly expanded: ReadonlySet<string>;
  readonly loading: ReadonlySet<string>;
  /**
   * `hasMore` per parent id. Use the sentinel key `'__root__'` for the
   * top-level folder list. Absent => no sentinel is rendered for that parent.
   */
  readonly childrenHasMore: Readonly<Record<string, boolean>>;
  /**
   * Per-parent "loading next page" flag. Same key convention as above.
   */
  readonly childrenLoadingMore: ReadonlySet<string>;
}

export const ROOT_SENTINEL_KEY = '__root__';

/**
 * Historical signature (positional) kept for the existing test suite and any
 * call sites we don't migrate in this pass. When `childrenHasMore` /
 * `childrenLoadingMore` are not provided, NO load-more sentinel is emitted —
 * behavior is identical to the pre-T11 flattener.
 */
export function flattenVisibleRows(
  rootIds: readonly string[],
  nodes: Readonly<Record<string, FolderNode>>,
  children: Readonly<Record<string, readonly string[]>>,
  expanded: ReadonlySet<string>,
  loading: ReadonlySet<string>,
  childrenHasMore: Readonly<Record<string, boolean>> = {},
  childrenLoadingMore: ReadonlySet<string> = new Set(),
): TreeRow[] {
  const rows: TreeRow[] = [];

  function traverse(id: string, depth: number): void {
    const node = nodes[id];
    if (!node) return;

    const isExpanded = expanded.has(id);
    const isLoading = loading.has(id);
    const childIds = children[id];
    const isLeaf = childIds !== undefined && childIds.length === 0;

    rows.push({
      kind: 'folder',
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
      if (childrenHasMore[id]) {
        rows.push({
          kind: 'load-more',
          id: `${id}:load-more`,
          parentId: id,
          depth: depth + 1,
          isLoading: childrenLoadingMore.has(id),
        });
      }
    }
  }

  for (const rootId of rootIds) {
    traverse(rootId, 0);
  }

  if (childrenHasMore[ROOT_SENTINEL_KEY]) {
    rows.push({
      kind: 'load-more',
      id: `${ROOT_SENTINEL_KEY}:load-more`,
      parentId: null,
      depth: 0,
      isLoading: childrenLoadingMore.has(ROOT_SENTINEL_KEY),
    });
  }

  return rows;
}
