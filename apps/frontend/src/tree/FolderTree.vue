<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTreeStore } from './tree.store';
import { useToastStore } from '@/stores/toasts';
import { flattenVisibleRows, type TreeRow } from './flattenVisibleRows';
import FolderNode from './FolderNode.vue';
import LoadMoreRow from './LoadMoreRow.vue';
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';

const route = useRoute();
const router = useRouter();
const tree = useTreeStore();
const toasts = useToastStore();

/**
 * Roving focus: exactly ONE treeitem is tabbable at a time. This matches the
 * WAI-ARIA tree pattern: Tab moves focus into/out of the tree, arrows move
 * focus WITHIN the tree. We track the focused id independently of selection
 * so focus never jumps back when the user clicks elsewhere and returns.
 */
const focusedId = ref<string | null>(null);

/**
 * Minimal surface we need from RecycleScroller. `InstanceType<typeof
 * RecycleScroller>` is unusable because the component is a generic functional
 * component, so we declare only the imperative API we rely on.
 */
interface VirtualScroller {
  scrollToItem: (index: number) => void;
}
const scrollerRef = ref<VirtualScroller | null>(null);

onMounted(async () => {
  // 1) Rehydrate persisted intent (selected + expanded ids) so the UI paints
  //    with the user's last state BEFORE the network returns.
  const persisted = tree.hydrateFromStorage();

  // 2) Load root folders.
  await tree.loadRoot();

  // 3) Route param wins over persisted selection (deep-link > last session).
  const routeId = typeof route.params.id === 'string' ? route.params.id : undefined;
  const targetId = routeId ?? persisted.selectedId ?? null;

  if (targetId) {
    await tree.loadPath(targetId);
    tree.select(targetId);
    focusedId.value = targetId;
    // Deep-link: ensure the resolved row is scrolled into view and focused
    // once the tree has re-rendered with the expanded ancestors.
    await nextTick();
    focusVisibleRow(targetId, { scroll: true });
  } else {
    // Rehydrate the persisted expanded chain so the tree shape matches last
    // session even without a selection.
    await tree.rehydrateExpanded(persisted.expanded);

    // Auto-expand all root folders on first load when there's nothing to
    // rehydrate. Without this the user lands on a tree showing only the
    // collapsed root(s) and has to manually click each chevron — but the
    // Explorer-style UX (and what the user expects) is "I just opened
    // the app, show me what's at the top". We only do this when there
    // is no persisted expanded set so a user who deliberately collapsed
    // everything in their previous session keeps that state.
    if (persisted.expanded.length === 0 && tree.rootIds.length > 0) {
      // Pull this through `toggleExpand` so we get child fetching + the
      // store's invariants (no double-add to `expanded`) for free.
      await Promise.all(tree.rootIds.map((id) => tree.toggleExpand(id)));
    }

    focusedId.value = tree.rootIds[0] ?? null;
  }
});

watch(
  () => route.params.id,
  async (newId) => {
    if (newId && typeof newId === 'string') {
      await tree.loadPath(newId);
      tree.select(newId);
      focusedId.value = newId;
      await nextTick();
      focusVisibleRow(newId, { scroll: true });
    } else {
      tree.select(null);
    }
  },
);

const visibleRows = computed<TreeRow[]>(() =>
  flattenVisibleRows(
    tree.rootIds,
    tree.nodes,
    tree.children,
    tree.expanded,
    tree.loading,
    tree.childrenHasMore,
    tree.loadingMore,
  ),
);

/**
 * Minimum width for the (scrollable) tree content area (lp4).
 *
 * Each depth level consumes `INDENT_REM` rem of padding-left (see
 * `FolderNode`/`LoadMoreRow`). On top of that a row needs room for its
 * chevron + folder icon + label. When the deepest visible row would
 * otherwise run off the panel's right edge, we widen the inner container
 * so the wrapper's `overflow-x-auto` can reveal the tail via horizontal
 * scroll. Using the LARGEST visible depth (not a pessimistic global max)
 * keeps scroll range honest as the user expands/collapses.
 */
const INDENT_REM = 0.75;
const ROW_RESERVED_PX = 240;
const maxVisibleDepth = computed(() => {
  let max = 0;
  for (const r of visibleRows.value) {
    if (r.depth > max) max = r.depth;
  }
  return max;
});
const treeMinWidthPx = computed(() => {
  // 1 rem = 16 px (Tailwind default). Keep it a CSS px string so inline
  // style doesn't need a unit conversion at paint time.
  const indentPx = maxVisibleDepth.value * INDENT_REM * 16;
  return `${indentPx + ROW_RESERVED_PX}px`;
});

function activateLoadMore(parentId: string | null): void {
  if (parentId === null) {
    void tree.loadMoreRoot();
  } else {
    void tree.loadMoreChildren(parentId);
  }
}

const focusedIndex = computed(() => {
  if (!focusedId.value) return -1;
  return visibleRows.value.findIndex((r) => r.id === focusedId.value);
});

function handleToggle(id: string): void {
  tree.toggleExpand(id);
}

function handleSelect(id: string): void {
  tree.select(id);
  focusedId.value = id;
  router.push({ name: 'folders', params: { id } });
}

/**
 * Scroll a row into view and DOM-focus it. The row may not yet be mounted
 * (virtualized), so we retry focus across a few animation frames after
 * asking the scroller to reveal it. This is the core fix for "the focused
 * row disappears as I navigate deep" because `querySelector` alone can't
 * see rows outside the virtual window.
 */
function focusVisibleRow(id: string, opts: { scroll: boolean } = { scroll: true }): void {
  const rows = visibleRows.value;
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return;

  if (opts.scroll && typeof scrollerRef.value?.scrollToItem === 'function') {
    scrollerRef.value.scrollToItem(idx);
  }

  const MAX_ATTEMPTS = 5;
  let attempts = 0;
  const tryFocus = (): void => {
    attempts += 1;
    const el = document.querySelector<HTMLElement>(`[data-tree-item-id="${id}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      return;
    }
    if (attempts < MAX_ATTEMPTS) {
      requestAnimationFrame(tryFocus);
    }
  };
  requestAnimationFrame(tryFocus);
}

function moveFocus(nextId: string): void {
  focusedId.value = nextId;
  void nextTick(() => {
    focusVisibleRow(nextId, { scroll: true });
  });
}

/**
 * Soft-delete the focused folder after explicit confirmation. We keep this
 * minimal on purpose: the browser's built-in `confirm()` is accessible, maps
 * the Escape key to cancel, and avoids bringing a modal subsystem online for
 * what is a rare, destructive action. If the user cancels we no-op.
 *
 * After a successful delete the store prunes the id locally and clears
 * selection if it matched. We shift focus to the next-sibling-or-previous
 * row so keyboard users aren't thrown back to the top.
 */
async function handleDelete(row: Extract<TreeRow, { kind: 'folder' }>): Promise<void> {
  const rows = visibleRows.value;
  const idx = rows.findIndex((r) => r.id === row.id);
  const neighbor = rows[idx + 1] ?? rows[idx - 1] ?? null;

  const ok =
    typeof window !== 'undefined'
      ? window.confirm(
          `Delete "${row.node.name}" and all its contents?\n\n` +
            `The folder will be soft-deleted and can be restored.`,
        )
      : false;
  if (!ok) return;

  // Capture restore context BEFORE softDelete prunes the node from the store.
  // The parent id and the displayed name are read once and closed over by the
  // toast's Undo handler — `tree.nodes[row.id]` is gone after the delete.
  const parentId = tree.nodes[row.id]?.parentId ?? null;
  const deletedId = row.id;
  const deletedName = row.node.name;

  const wasSelected = tree.selectedId === row.id;
  try {
    await tree.softDelete(row.id);
  } catch {
    return;
  }
  if (wasSelected) {
    await router.push({ name: 'folders' });
  }
  if (neighbor) {
    moveFocus(neighbor.id);
  } else {
    focusedId.value = null;
  }

  toasts.show({
    message: `Folder "${deletedName}" deleted.`,
    variant: 'success',
    action: {
      label: 'Undo',
      async onActivate() {
        await tree.restoreFolder(deletedId, parentId);
      },
    },
  });
}

function handleKeydown(e: KeyboardEvent): void {
  const rows = visibleRows.value;
  const idx = focusedIndex.value;
  if (idx < 0) return;
  const row = rows[idx];
  if (!row) return;

  // Load-more sentinel rows only react to navigation + Enter/Space.
  if (row.kind === 'load-more') {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (idx < rows.length - 1) moveFocus(rows[idx + 1]!.id);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (idx > 0) moveFocus(rows[idx - 1]!.id);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        activateLoadMore(row.parentId);
        return;
      default:
        return;
    }
  }

  switch (e.key) {
    case 'Delete': {
      e.preventDefault();
      void handleDelete(row);
      break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      if (idx < rows.length - 1) moveFocus(rows[idx + 1]!.id);
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      if (idx > 0) moveFocus(rows[idx - 1]!.id);
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      if (!row.isExpanded) {
        handleToggle(row.id);
      } else if (idx < rows.length - 1) {
        moveFocus(rows[idx + 1]!.id);
      }
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      if (row.isExpanded) {
        handleToggle(row.id);
      } else if (row.node.parentId) {
        moveFocus(row.node.parentId);
      }
      break;
    }
    case 'Home': {
      e.preventDefault();
      if (rows[0]) moveFocus(rows[0].id);
      break;
    }
    case 'End': {
      e.preventDefault();
      const last = rows[rows.length - 1];
      if (last) moveFocus(last.id);
      break;
    }
    case 'Enter':
    case ' ': {
      e.preventDefault();
      handleSelect(row.id);
      break;
    }
  }
}
</script>

<template>
  <div
    class="h-full w-full flex flex-col"
    @keydown="handleKeydown"
  >
    <div
      v-if="tree.loading.has('root')"
      class="p-4 text-sm text-slate-500"
      role="status"
    >
      Loading tree...
    </div>
    <div
      v-else-if="tree.error"
      class="p-4 text-sm text-red-600"
      role="alert"
    >
      <div class="font-medium">{{ tree.error.message }}</div>
      <div class="mt-1 text-xs text-red-500">
        {{ tree.error.code }} · op: {{ tree.error.op }}
        <span v-if="tree.error.requestId"> · req: {{ tree.error.requestId }}</span>
      </div>
      <button
        class="mt-2 text-xs text-sky-600 hover:underline"
        @click="tree.clearError()"
      >
        Dismiss
      </button>
    </div>
    <!--
      Horizontal-scroll wrapper (lp4): the virtual scroller is a vertical
      scroll container, so we give it a `min-width` wider than the panel
      when deep trees push their last-visible column off the panel's right
      edge. `overflow-x-auto` on the wrapper then gives the user a native
      horizontal scrollbar instead of silently clipping deep rows. The
      wrapper's `overflow-y-hidden` is important: RecycleScroller owns the
      Y scrollbar inside; we only take X here.
    -->
    <div
      v-else
      class="flex-1 overflow-x-auto overflow-y-hidden"
      role="tree"
      aria-label="Folders"
    >
      <div
        class="h-full"
        :style="{ minWidth: treeMinWidthPx }"
      >
        <RecycleScroller
          ref="scrollerRef"
          v-slot="{ item }"
          class="h-full w-full"
          :items="visibleRows"
          :item-size="32"
          key-field="id"
        >
          <FolderNode
            v-if="item.kind === 'folder'"
            :row="item"
            :is-selected="tree.selectedId === item.id"
            :is-focused="focusedId === item.id"
            @toggle="handleToggle"
            @select="handleSelect"
            @focus="focusedId = item.id"
          />
          <LoadMoreRow
            v-else
            :depth="item.depth"
            :is-loading="item.isLoading"
            :is-focused="focusedId === item.id"
            @activate="activateLoadMore(item.parentId)"
            @focus="focusedId = item.id"
          />
        </RecycleScroller>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vue-recycle-scroller {
  direction: ltr;
}
</style>
