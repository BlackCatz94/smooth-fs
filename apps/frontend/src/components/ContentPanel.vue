<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import { useContents } from '@/composables/useContents';
import { Folder, Loader2, Trash2 } from 'lucide-vue-next';
import type { FileNode } from '@smoothfs/shared';
import { useStatusStore } from '@/stores/status';
import { useTreeStore } from '@/tree/tree.store';
import { fileIconFor } from '@/lib/fileIcon';
import FilePreviewDialog from './FilePreviewDialog.vue';

/**
 * Right panel (content view). Matches the Windows Explorer paradigm:
 *   - Single click  -> select (highlight + status bar context).
 *   - Double click  -> folder: navigate; file: open file-info dialog.
 *   - Enter/Space   -> same as double click on the focused tile.
 *   - Arrow keys    -> move focus between tiles (roving tabindex).
 *
 * Rendering is virtualized via `<RecycleScroller>` in grid mode so the panel
 * stays at ~60 fps even when a folder contains 10^4+ items. Pagination is
 * driven by the scroller's `@update` event: when the visible window nears the
 * tail of `items` we fetch the next page through `useContents`.
 */

const route = useRoute();
const router = useRouter();
const status = useStatusStore();
const tree = useTreeStore();
const selectedFolderId = computed(() => route.params.id as string | undefined);

const {
  folders,
  files,
  loading,
  error,
  hasMoreFolders,
  hasMoreFiles,
  loadingMore,
  loadMoreFolders,
  loadMoreFiles,
  removeFolder,
} = useContents(() => selectedFolderId.value);

const hasMore = computed(() => hasMoreFolders.value || hasMoreFiles.value);

async function loadMore(): Promise<void> {
  // Drain folders first (they render before files) to match the visual order.
  if (hasMoreFolders.value) {
    await loadMoreFolders();
    return;
  }
  if (hasMoreFiles.value) {
    await loadMoreFiles();
  }
}

type ItemKind = 'folder' | 'file';
interface FlatItem {
  readonly key: string;
  readonly kind: ItemKind;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

const items = computed<FlatItem[]>(() => {
  const out: FlatItem[] = [];
  for (const f of folders.value) {
    out.push({ key: `folder:${f.id}`, kind: 'folder', id: f.id, name: f.name, updatedAt: f.updatedAt });
  }
  for (const f of files.value) {
    out.push({ key: `file:${f.id}`, kind: 'file', id: f.id, name: f.name, updatedAt: f.updatedAt });
  }
  return out;
});

const selectedKey = ref<string | null>(null);
const focusedKey = ref<string | null>(null);
const previewFile = ref<FileNode | null>(null);

watch(selectedFolderId, () => {
  selectedKey.value = null;
  focusedKey.value = null;
  status.reset();
});

watch(
  [folders, files],
  ([f, fi]) => {
    status.setCounts(f.length, fi.length);
  },
  { immediate: true },
);

watch(selectedKey, (key) => {
  if (!key) {
    status.setSelected(null);
    return;
  }
  const item = items.value.find((i) => i.key === key);
  status.setSelected(item?.name ?? null);
});

watch(
  items,
  (next) => {
    if (focusedKey.value && next.some((i) => i.key === focusedKey.value)) return;
    focusedKey.value = next[0]?.key ?? null;
  },
  { immediate: true },
);

function activateItem(item: FlatItem): void {
  if (item.kind === 'folder') {
    router.push({ name: 'folders', params: { id: item.id } });
    return;
  }
  const file = files.value.find((f) => f.id === item.id);
  previewFile.value = file ?? null;
}

function onItemClick(item: FlatItem): void {
  selectedKey.value = item.key;
  focusedKey.value = item.key;
}

function onItemDblClick(item: FlatItem): void {
  selectedKey.value = item.key;
  focusedKey.value = item.key;
  activateItem(item);
}

/**
 * Soft-delete the currently focused/selected folder item. Files have no
 * corresponding endpoint yet, so we no-op on them. We prune the row both
 * from the global tree store (so the left panel updates) and the local
 * right-panel list (via `removeFolder`) so neither needs a refetch.
 */
const deletingKey = ref<string | null>(null);
async function deleteFolderItem(item: FlatItem): Promise<void> {
  if (item.kind !== 'folder') return;
  const ok =
    typeof window !== 'undefined'
      ? window.confirm(
          `Delete "${item.name}" and all its contents?\n\n` +
            `The folder will be soft-deleted and can be restored.`,
        )
      : false;
  if (!ok) return;

  deletingKey.value = item.key;
  try {
    await tree.softDelete(item.id);
    removeFolder(item.id);
  } catch {
    return;
  } finally {
    deletingKey.value = null;
  }

  // Shift focus/selection to a neighbor so keyboard flow doesn't jump to top.
  const remaining = items.value;
  const fallback = remaining[0] ?? null;
  selectedKey.value = null;
  focusedKey.value = fallback?.key ?? null;
}

const selectedItem = computed<FlatItem | null>(() =>
  selectedKey.value ? items.value.find((i) => i.key === selectedKey.value) ?? null : null,
);
const canDeleteSelection = computed(() => selectedItem.value?.kind === 'folder');

function onItemKeydown(e: KeyboardEvent, index: number): void {
  const list = items.value;
  if (list.length === 0) return;
  const current = list[index];
  if (!current) return;

  const cols = columns.value;
  switch (e.key) {
    case 'Delete': {
      if (current.kind !== 'folder') return;
      e.preventDefault();
      void deleteFolderItem(current);
      break;
    }
    case 'Enter':
    case ' ': {
      e.preventDefault();
      selectedKey.value = current.key;
      activateItem(current);
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      const next = list[Math.min(index + 1, list.length - 1)];
      if (next) focusIndex(list.indexOf(next));
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      const prev = list[Math.max(index - 1, 0)];
      if (prev) focusIndex(list.indexOf(prev));
      break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      const next = list[Math.min(index + cols, list.length - 1)];
      if (next) focusIndex(list.indexOf(next));
      break;
    }
    case 'ArrowUp': {
      e.preventDefault();
      const prev = list[Math.max(index - cols, 0)];
      if (prev) focusIndex(list.indexOf(prev));
      break;
    }
    case 'Home': {
      e.preventDefault();
      focusIndex(0);
      break;
    }
    case 'End': {
      e.preventDefault();
      focusIndex(list.length - 1);
      break;
    }
  }
}

interface ScrollerInstance {
  scrollToItem(index: number): void;
}
const scrollerRef = ref<ScrollerInstance | null>(null);

function focusIndex(index: number): void {
  const target = items.value[index];
  if (!target) return;
  focusedKey.value = target.key;
  // RecycleScroller may have the item off-screen. Scroll first, let DOM
  // flush, then focus — two rAFs give RecycleScroller a tick to recycle.
  scrollerRef.value?.scrollToItem(index);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-content-item-key="${target.key}"]`,
      );
      el?.focus({ preventScroll: true });
    });
  });
}

function closePreview(): void {
  previewFile.value = null;
}

/**
 * Responsive column count for the virtualized grid. We stick to the same
 * breakpoints as the old static Tailwind grid so layout parity is preserved.
 */
const columns = ref(1);
const mediaQueries: { mq: MediaQueryList; cols: number }[] = [];
function recomputeColumns(): void {
  for (const { mq, cols } of mediaQueries) {
    if (mq.matches) {
      columns.value = cols;
      return;
    }
  }
  columns.value = 1;
}
onMounted(() => {
  if (typeof window === 'undefined') return;
  // Order matters: widest first so we pick the largest matching breakpoint.
  mediaQueries.push(
    { mq: window.matchMedia('(min-width: 1280px)'), cols: 4 },
    { mq: window.matchMedia('(min-width: 1024px)'), cols: 3 },
    { mq: window.matchMedia('(min-width: 768px)'), cols: 2 },
  );
  recomputeColumns();
  for (const { mq } of mediaQueries) {
    mq.addEventListener('change', recomputeColumns);
  }
});
onBeforeUnmount(() => {
  for (const { mq } of mediaQueries) {
    mq.removeEventListener('change', recomputeColumns);
  }
});

/**
 * RecycleScroller `@update(startIndex, endIndex)` — when the visible window
 * is near the tail of the current page, kick off the next page. Uses a small
 * lookahead (`PREFETCH`) so the next page lands before the user hits the end.
 */
const PREFETCH = 8;
function onScrollerUpdate(_startIndex: number, endIndex: number): void {
  if (!hasMore.value || loadingMore.value) return;
  if (endIndex >= items.value.length - PREFETCH) {
    void loadMore();
  }
}
</script>

<template>
  <div class="h-full w-full p-4">
    <div
      v-if="!selectedFolderId"
      class="flex h-full items-center justify-center text-slate-500"
    >
      Select a folder to view its contents
    </div>

    <div
      v-else-if="loading"
      class="flex h-full items-center justify-center"
    >
      <div
        class="h-8 w-8 animate-spin rounded-full border-4 border-sky-500 border-t-transparent"
        role="status"
        aria-label="Loading contents"
      />
    </div>

    <div
      v-else-if="error"
      class="flex h-full flex-col items-center justify-center gap-1 text-red-600"
      role="alert"
    >
      <div class="font-medium">{{ error.message }}</div>
      <div class="text-xs text-red-500">
        {{ error.code }} · op: {{ error.op }}
        <span v-if="error.requestId"> · req: {{ error.requestId }}</span>
      </div>
    </div>

    <div
      v-else-if="items.length === 0"
      class="flex h-full items-center justify-center text-slate-500"
    >
      This folder is empty
    </div>

    <div
      v-else
      class="flex h-full flex-col"
    >
      <div
        class="mb-2 flex shrink-0 items-center justify-end gap-2"
        role="toolbar"
        aria-label="Content actions"
      >
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-red-300 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
          :disabled="!canDeleteSelection || deletingKey !== null"
          :title="canDeleteSelection ? 'Delete selected folder (Delete)' : 'Select a folder to delete'"
          data-testid="content-delete"
          @click="() => selectedItem && deleteFolderItem(selectedItem)"
        >
          <Loader2
            v-if="deletingKey !== null"
            class="h-3.5 w-3.5 animate-spin"
          />
          <Trash2
            v-else
            class="h-3.5 w-3.5"
          />
          Delete
        </button>
      </div>

      <div
        class="flex-1 min-h-0"
        role="list"
        aria-label="Folder contents"
      >
        <RecycleScroller
          ref="scrollerRef"
          v-slot="{ item, index }"
          class="h-full w-full"
          :items="items"
          :item-size="84"
          :grid-items="columns"
          key-field="key"
          @update="onScrollerUpdate"
        >
          <div
            :data-content-item-key="item.key"
            :data-content-item-kind="item.kind"
            role="listitem"
            :aria-selected="selectedKey === item.key"
            :tabindex="focusedKey === item.key ? 0 : -1"
            class="m-2 flex items-center gap-3 rounded-lg border bg-white p-3 shadow-sm transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-sky-500"
            :class="[
              selectedKey === item.key
                ? 'border-sky-400 bg-sky-50'
                : 'border-slate-200 hover:border-slate-300 hover:shadow',
            ]"
            @click="onItemClick(item)"
            @dblclick="onItemDblClick(item)"
            @focus="focusedKey = item.key"
            @keydown="onItemKeydown($event, index)"
          >
            <Folder
              v-if="item.kind === 'folder'"
              class="h-8 w-8 text-sky-500 flex-shrink-0"
              aria-hidden="true"
            />
            <component
              :is="fileIconFor(item.name).icon"
              v-else
              class="h-8 w-8 flex-shrink-0"
              :class="fileIconFor(item.name).color"
              aria-hidden="true"
            />
            <div class="flex flex-col overflow-hidden">
              <span class="truncate font-medium text-slate-900">{{ item.name }}</span>
              <span class="text-xs text-slate-500">
                {{ new Date(item.updatedAt).toLocaleDateString() }}
              </span>
            </div>
          </div>
        </RecycleScroller>
      </div>

      <div
        v-if="hasMore"
        class="mt-2 flex items-center justify-center border-t border-slate-100 py-2"
        data-testid="content-load-more"
      >
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="loadingMore"
          @click="loadMore"
        >
          <Loader2
            v-if="loadingMore"
            class="h-4 w-4 animate-spin"
          />
          {{ loadingMore ? 'Loading...' : 'Load more' }}
        </button>
      </div>
    </div>

    <FilePreviewDialog
      :file="previewFile"
      @close="closePreview"
    />
  </div>
</template>
