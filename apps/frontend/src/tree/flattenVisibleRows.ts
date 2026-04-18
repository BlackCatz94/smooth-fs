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
   * Tri-state:
   *   - `true`  — children may exist (either fetched and non-empty, or unknown
   *               but the server's `hasChildFolders` flag says there's at
   *               least one live folder child).
   *   - `false` — confirmed leaf: either children have been fetched and the
   *               list is empty, or the server already told us there are no
   *               folder children (`node.hasChildFolders === false`).
   *
   * Leaves drop `aria-expanded` from their treeitem and hide the chevron so
   * assistive tech and sighted users both see a confirmed leaf.
   */
  hasChildren: boolean;
  /**
   * `true` when we can prove the folder has zero folder children, either
   * from the server's upfront `hasChildFolders` flag or from an observed
   * empty children page. The server flag lets us suppress the chevron on
   * first paint, avoiding the "click the arrow, nothing happens, arrow
   * vanishes" flash users saw before Phase 5+.
   */
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
    // Confirmed leaf either from an observed empty children page (classic
    // path, survives the backend flag being wrong) or from the server's
    // upfront `hasChildFolders` flag (preempts the chevron click for
    // branches we haven't fetched yet). `hasChildFolders === false` is a
    // strong signal: the backend computes it via an index-backed EXISTS
    // over live rows, invalidated on every folder write.
    const observedLeaf = childIds !== undefined && childIds.length === 0;
    const knownLeaf = node.hasChildFolders === false;
    const isLeaf = observedLeaf || knownLeaf;

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
