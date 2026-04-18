import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { LIST_MAX_LIMIT, type FolderNode } from '@smoothfs/shared';
import { foldersApi } from '@/lib/api/folders';
import { normalizeUiError, type UiError } from '@/lib/api/error';
import { loadPersistedState, savePersistedState } from './persistence';
import { ROOT_SENTINEL_KEY } from './flattenVisibleRows';

/**
 * Page size used when fetching tree children. We stay at the backend's
 * validated ceiling so one click = one network round-trip under normal
 * usage. When a parent exceeds this, the UI renders a "Load N more"
 * sentinel row and the user (or scroller) explicitly asks for the next
 * page. This replaces the old eager `fetchAllChildren` loop that could
 * pull down thousands of siblings in a single expand.
 */
const PAGE_SIZE = LIST_MAX_LIMIT;

interface ChildrenPage {
  readonly data: { readonly items: readonly FolderNode[] };
  readonly meta: {
    readonly cursor?: string | null | undefined;
    readonly hasMore?: boolean | undefined;
  };
}

export const useTreeStore = defineStore('tree', () => {
  const nodes = ref<Record<string, FolderNode>>({});
  const children = ref<Record<string, string[]>>({});
  const rootIds = ref<string[]>([]);
  const expanded = ref<Set<string>>(new Set());
  const selectedId = ref<string | null>(null);
  /** Which first-page fetches (parent-id or 'root') are in flight. */
  const loading = ref<Set<string>>(new Set());
  /**
   * Which subsequent-page fetches are in flight. Keyed by parent id;
   * root uses the sentinel `ROOT_SENTINEL_KEY` so the same record type
   * covers both.
   */
  const loadingMore = ref<Set<string>>(new Set());
  /**
   * Next-page cursor per parent id (and `ROOT_SENTINEL_KEY`). `null`
   * means "we have reached the end and should not render a sentinel".
   */
  const childrenCursor = ref<Record<string, string | null>>({});
  /** `hasMore` per parent id (same key convention). */
  const childrenHasMore = ref<Record<string, boolean>>({});
  const error = ref<UiError | null>(null);

  function hydrateFromStorage(): { selectedId: string | null; expanded: string[] } {
    const persisted = loadPersistedState();
    if (!persisted) return { selectedId: null, expanded: [] };
    selectedId.value = persisted.selectedId;
    expanded.value = new Set(persisted.expanded);
    return persisted;
  }

  watch(
    [selectedId, expanded],
    () => {
      savePersistedState({
        selectedId: selectedId.value,
        expanded: Array.from(expanded.value),
      });
    },
    { deep: true },
  );

  function mergePage(parentKey: string, page: ChildrenPage, existing: string[]): string[] {
    for (const item of page.data.items) {
      nodes.value[item.id] = item;
    }
    const seen = new Set(existing);
    const next = existing.slice();
    for (const item of page.data.items) {
      if (!seen.has(item.id)) {
        next.push(item.id);
        seen.add(item.id);
      }
    }
    childrenCursor.value[parentKey] = page.meta.cursor ?? null;
    childrenHasMore.value[parentKey] = Boolean(page.meta.hasMore && page.meta.cursor);
    return next;
  }

  async function loadRoot(): Promise<void> {
    try {
      loading.value.add('root');
      error.value = null;
      const res = (await foldersApi.getRoot({ limit: PAGE_SIZE })) as ChildrenPage;
      rootIds.value = mergePage(ROOT_SENTINEL_KEY, res, []);
    } catch (err) {
      error.value = normalizeUiError(err, 'loadRoot');
    } finally {
      loading.value.delete('root');
    }
  }

  async function loadMoreRoot(): Promise<void> {
    if (loadingMore.value.has(ROOT_SENTINEL_KEY)) return;
    if (!childrenHasMore.value[ROOT_SENTINEL_KEY]) return;
    const cursor = childrenCursor.value[ROOT_SENTINEL_KEY];
    if (!cursor) return;

    try {
      loadingMore.value.add(ROOT_SENTINEL_KEY);
      const res = (await foldersApi.getRoot({
        limit: PAGE_SIZE,
        cursor,
      })) as ChildrenPage;
      rootIds.value = mergePage(ROOT_SENTINEL_KEY, res, rootIds.value);
    } catch (err) {
      error.value = normalizeUiError(err, 'loadMoreRoot');
    } finally {
      loadingMore.value.delete(ROOT_SENTINEL_KEY);
    }
  }

  async function loadChildren(parentId: string, force = false): Promise<void> {
    if (!force && children.value[parentId] !== undefined) return;
    try {
      loading.value.add(parentId);
      const res = (await foldersApi.getChildren(parentId, {
        limit: PAGE_SIZE,
      })) as ChildrenPage;
      children.value[parentId] = mergePage(parentId, res, []);
    } catch (err) {
      error.value = normalizeUiError(err, 'loadChildren');
    } finally {
      loading.value.delete(parentId);
    }
  }

  async function loadMoreChildren(parentId: string): Promise<void> {
    if (loadingMore.value.has(parentId)) return;
    if (!childrenHasMore.value[parentId]) return;
    const cursor = childrenCursor.value[parentId];
    if (!cursor) return;

    try {
      loadingMore.value.add(parentId);
      const res = (await foldersApi.getChildren(parentId, {
        limit: PAGE_SIZE,
        cursor,
      })) as ChildrenPage;
      children.value[parentId] = mergePage(
        parentId,
        res,
        children.value[parentId] ?? [],
      );
    } catch (err) {
      error.value = normalizeUiError(err, 'loadMoreChildren');
    } finally {
      loadingMore.value.delete(parentId);
    }
  }

  /**
   * Remove `id` and every one of its already-loaded descendants from the
   * `expanded` set. Without this, collapsing a parent would "remember" that
   * its grandchildren were expanded — so re-expanding the parent later would
   * recursively unfold the whole subtree, surprising users who expected a
   * collapse to mean "hide everything under here".
   *
   * We only walk the `children[]` graph we've already fetched: unknown
   * subtrees are irrelevant because they can't be in `expanded` anyway.
   * Iterative (stack) rather than recursive so a deep chain can't blow the
   * JS stack.
   */
  function collapseSubtree(rootId: string, set: Set<string>): void {
    const stack: string[] = [rootId];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      set.delete(id);
      const kids = children.value[id];
      if (!kids) continue;
      for (const childId of kids) stack.push(childId);
    }
  }

  async function toggleExpand(id: string): Promise<void> {
    if (expanded.value.has(id)) {
      const next = new Set(expanded.value);
      collapseSubtree(id, next);
      expanded.value = next;
    } else {
      const next = new Set(expanded.value);
      next.add(id);
      expanded.value = next;
      await loadChildren(id);
    }
  }

  function select(id: string | null): void {
    selectedId.value = id;
  }

  /**
   * Materialize the ancestor chain for `id`. We fetch one page per ancestor
   * (no eager pagination). If the target isn't present in its parent's first
   * page we append it so a deep-link to a late-sibling still renders. That
   * re-insert is out-of-sort-order by design: correctness (the user sees
   * their folder) trumps alphabetical placement for a rare direct-link case.
   */
  async function loadPath(id: string): Promise<void> {
    try {
      const res = await foldersApi.getPath(id);
      const items = res.data.items;
      const next = new Set(expanded.value);

      for (const item of items) {
        nodes.value[item.id] = item;
      }

      for (const item of items) {
        if (item.id === id) continue;
        next.add(item.id);
        await loadChildren(item.id);
        const parentKids = children.value[item.id] ?? [];
        const nextChildId = items[items.indexOf(item) + 1]?.id;
        if (nextChildId && !parentKids.includes(nextChildId)) {
          // Deep-link fell beyond the first page. Force-insert to keep the
          // selected chain visible; user can still hit "Load more" to fill
          // in the siblings.
          children.value[item.id] = [...parentKids, nextChildId];
        }
      }
      expanded.value = next;
    } catch (err) {
      error.value = normalizeUiError(err, 'loadPath');
    }
  }

  async function rehydrateExpanded(expandedIds: readonly string[]): Promise<void> {
    if (expandedIds.length === 0) return;
    await Promise.all(expandedIds.map((pid) => loadChildren(pid)));
  }

  function clearError(): void {
    error.value = null;
  }

  /**
   * Undo a folder soft-delete. We can't reconstruct subtree state from local
   * memory (softDelete pruned the descendants), so we re-fetch the parent's
   * first child page — the restored folder reappears in alphabetical order
   * and the user can re-expand its descendants on demand.
   *
   * `parentId` is supplied by the caller (the toast handler captured it
   * before delete). Passing it explicitly is cheaper and more correct than
   * trying to re-derive it from a server round-trip.
   */
  async function restoreFolder(id: string, parentId: string | null): Promise<void> {
    try {
      loading.value.add(id);
      error.value = null;
      await foldersApi.restore(id);
      // Re-fetch the parent's children so the restored folder shows up in
      // its sorted position. We force-reload (override the "already loaded"
      // short-circuit in `loadChildren`) since the cached list omits the
      // restored row.
      if (parentId === null) {
        await loadRoot();
      } else {
        await loadChildren(parentId, true);
      }
    } catch (err) {
      error.value = normalizeUiError(err, 'restoreFolder');
      throw err;
    } finally {
      loading.value.delete(id);
    }
  }

  async function softDelete(id: string): Promise<void> {
    try {
      loading.value.add(id);
      error.value = null;
      await foldersApi.softDelete(id);

      const parentId = nodes.value[id]?.parentId ?? null;

      const stack: string[] = [id];
      const toRemove: string[] = [];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        toRemove.push(cur);
        const kids = children.value[cur];
        if (kids) for (const k of kids) stack.push(k);
      }

      const nextExpanded = new Set(expanded.value);
      for (const rid of toRemove) {
        delete nodes.value[rid];
        delete children.value[rid];
        delete childrenCursor.value[rid];
        delete childrenHasMore.value[rid];
        nextExpanded.delete(rid);
      }
      expanded.value = nextExpanded;

      if (parentId === null) {
        rootIds.value = rootIds.value.filter((x) => x !== id);
      } else {
        const siblings = children.value[parentId];
        if (siblings) {
          children.value[parentId] = siblings.filter((x) => x !== id);
        }
      }

      if (selectedId.value === id) {
        selectedId.value = null;
      }
    } catch (err) {
      error.value = normalizeUiError(err, 'softDelete');
      throw err;
    } finally {
      loading.value.delete(id);
    }
  }

  return {
    nodes,
    children,
    rootIds,
    expanded,
    selectedId,
    loading,
    loadingMore,
    childrenCursor,
    childrenHasMore,
    error,
    hydrateFromStorage,
    loadRoot,
    loadMoreRoot,
    loadChildren,
    loadMoreChildren,
    toggleExpand,
    select,
    loadPath,
    rehydrateExpanded,
    clearError,
    softDelete,
    restoreFolder,
  };
});
