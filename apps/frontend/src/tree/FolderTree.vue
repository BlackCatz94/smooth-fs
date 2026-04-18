<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTreeStore } from './tree.store';
import { flattenVisibleRows } from './flattenVisibleRows';
import FolderNode from './FolderNode.vue';
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';

const route = useRoute();
const router = useRouter();
const tree = useTreeStore();

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

const visibleRows = computed(() =>
  flattenVisibleRows(
    tree.rootIds,
    tree.nodes,
    tree.children,
    tree.expanded,
    tree.loading,
  ),
);

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

function handleKeydown(e: KeyboardEvent): void {
  const rows = visibleRows.value;
  const idx = focusedIndex.value;
  if (idx < 0) return;
  const row = rows[idx];
  if (!row) return;

  switch (e.key) {
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
    role="tree"
    aria-label="Folders"
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
    <div
      v-else
      class="flex-1 overflow-hidden"
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
          :row="item"
          :is-selected="tree.selectedId === item.id"
          :is-focused="focusedId === item.id"
          @toggle="handleToggle"
          @select="handleSelect"
          @focus="focusedId = item.id"
        />
      </RecycleScroller>
    </div>
  </div>
</template>

<style scoped>
.vue-recycle-scroller {
  direction: ltr;
}
</style>
