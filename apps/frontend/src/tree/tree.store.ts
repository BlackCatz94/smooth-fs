import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { LIST_MAX_LIMIT, type FolderNode } from '@smoothfs/shared';
import { foldersApi } from '@/lib/api/folders';
import { normalizeUiError, type UiError } from '@/lib/api/error';
import { loadPersistedState, savePersistedState } from './persistence';

/**
 * Cursor-pages every child page until the server signals `hasMore=false`. We
 * page against `LIST_MAX_LIMIT` (the backend's enforced ceiling) so the tree
 * can host folders with arbitrarily many children without exceeding the
 * validation cap. The guard prevents runaway loops if the backend regresses
 * and returns `hasMore=true` forever.
 */
interface ChildrenPage {
  readonly data: { readonly items: readonly FolderNode[] };
  readonly meta: {
    readonly cursor?: string | null | undefined;
    readonly hasMore?: boolean | undefined;
  };
}

async function fetchAllChildren(
  fetchPage: (cursor: string | null) => Promise<ChildrenPage>,
): Promise<FolderNode[]> {
  const all: FolderNode[] = [];
  let cursor: string | null = null;
  // Generous cap: 200 pages × 200 rows = 40k children for one parent. If we
  // hit this, something is wrong server-side; fail loud rather than hang.
  for (let page = 0; page < 200; page += 1) {
    const res = await fetchPage(cursor);
    all.push(...res.data.items);
    if (!res.meta.hasMore || !res.meta.cursor) return all;
    cursor = res.meta.cursor;
  }
  throw new Error('fetchAllChildren: exceeded page cap (possible cursor loop)');
}

export const useTreeStore = defineStore('tree', () => {
  const nodes = ref<Record<string, FolderNode>>({});
  const children = ref<Record<string, string[]>>({});
  const rootIds = ref<string[]>([]);
  const expanded = ref<Set<string>>(new Set());
  const selectedId = ref<string | null>(null);
  const loading = ref<Set<string>>(new Set());
  const error = ref<UiError | null>(null);

  /**
   * Rehydrate selection + expanded-path from localStorage before the network
   * roundtrip finishes. We only restore intent (ids); materialization (actual
   * fetched children) happens after `loadRoot` + `loadPath` run.
   */
  function hydrateFromStorage(): { selectedId: string | null; expanded: string[] } {
    const persisted = loadPersistedState();
    if (!persisted) return { selectedId: null, expanded: [] };
    selectedId.value = persisted.selectedId;
    expanded.value = new Set(persisted.expanded);
    return persisted;
  }

  /**
   * Persist-on-mutation. Kept deliberately narrow (selected + expanded) —
   * we do NOT persist `nodes`/`children` because they can grow unbounded and
   * the server is the source of truth for tree shape.
   */
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

  async function loadRoot() {
    try {
      loading.value.add('root');
      error.value = null;
      const items = await fetchAllChildren((cursor) =>
        foldersApi.getRoot({
          limit: LIST_MAX_LIMIT,
          cursor: cursor ?? undefined,
        }),
      );
      for (const item of items) {
        nodes.value[item.id] = item;
      }
      rootIds.value = items.map((i) => i.id);
    } catch (err) {
      error.value = normalizeUiError(err, 'loadRoot');
    } finally {
      loading.value.delete('root');
    }
  }

  async function loadChildren(parentId: string, force = false): Promise<void> {
    if (!force && children.value[parentId] !== undefined) return;
    try {
      loading.value.add(parentId);
      const items = await fetchAllChildren((cursor) =>
        foldersApi.getChildren(parentId, {
          limit: LIST_MAX_LIMIT,
          cursor: cursor ?? undefined,
        }),
      );
      for (const item of items) {
        nodes.value[item.id] = item;
      }
      children.value[parentId] = items.map((i) => i.id);
    } catch (err) {
      error.value = normalizeUiError(err, 'loadChildren');
    } finally {
      loading.value.delete(parentId);
    }
  }

  async function toggleExpand(id: string): Promise<void> {
    if (expanded.value.has(id)) {
      // Clone to trigger reactivity (Set mutation alone isn't deep-watched
      // reliably across all Vue refs + bundler configs).
      const next = new Set(expanded.value);
      next.delete(id);
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
   * Materialize the ancestor chain for `id` so direct-link / rehydrated state
   * renders with everything expanded down to the selected node.
   */
  async function loadPath(id: string): Promise<void> {
    try {
      const res = await foldersApi.getPath(id);
      const next = new Set(expanded.value);
      for (const item of res.data.items) {
        nodes.value[item.id] = item;
        if (item.id !== id) {
          next.add(item.id);
          await loadChildren(item.id);
        }
      }
      expanded.value = next;
    } catch (err) {
      error.value = normalizeUiError(err, 'loadPath');
    }
  }

  /**
   * Best-effort rehydration of a persisted expanded-set after `loadRoot`.
   * Children fetches are fire-and-forget in parallel — if one fails, the
   * rest of the tree still renders and the error surfaces in `error`.
   */
  async function rehydrateExpanded(expandedIds: readonly string[]): Promise<void> {
    if (expandedIds.length === 0) return;
    await Promise.all(expandedIds.map((pid) => loadChildren(pid)));
  }

  function clearError(): void {
    error.value = null;
  }

  return {
    nodes,
    children,
    rootIds,
    expanded,
    selectedId,
    loading,
    error,
    hydrateFromStorage,
    loadRoot,
    loadChildren,
    toggleExpand,
    select,
    loadPath,
    rehydrateExpanded,
    clearError,
  };
});
