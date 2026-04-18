<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { RecycleScroller } from 'vue-virtual-scroller';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import { useContents } from '@/composables/useContents';
import { useGridKeyboardNav } from '@/composables/useGridKeyboardNav';
import { Folder, Loader2, Trash2 } from 'lucide-vue-next';
import type { FileNode } from '@smoothfs/shared';
import { useStatusStore } from '@/stores/status';
import { useToastStore } from '@/stores/toasts';
import { useTreeStore } from '@/tree/tree.store';
import { fileIconFor } from '@/lib/fileIcon';
import { filesApi } from '@/lib/api/files';
import { normalizeUiError, type UiError } from '@/lib/api/error';
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
const toasts = useToastStore();
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
  removeFile,
  refresh,
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

/**
 * Responsive column count for the virtualized grid. The VALUE is recomputed
 * from the actual scroll container's width (see `scrollerContainer` below)
 * via a ResizeObserver — NOT from `window.matchMedia`. Reason: the left
 * panel is resizable (lp5), so the content panel can change width without
 * the viewport changing at all. A viewport-based rule would either leave
 * whole empty strips (rp2) when the left panel is narrow, or cram tiny
 * tiles when the left panel is wide. Declared here (rather than beside
 * its wiring below) because `useGridKeyboardNav` reads it at setup time
 * and `<script setup>` `const`s are not hoisted.
 */
const columns = ref(1);
const containerWidth = ref(0);
const scrollerContainer = ref<HTMLElement | null>(null);

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

/**
 * Rapid-click activation that survives `vue-virtual-scroller` tile
 * recycling.
 *
 * Native `dblclick` fires only when both clicks of the same gesture land on
 * the *same DOM node*. The scroller recycles tiles aggressively (the
 * element under the cursor can be replaced when its `index` is reassigned
 * to a new item), so a user spam-clicking a folder would see only the
 * first dblclick fire — subsequent clicks during navigation/loading would
 * be swallowed because the second click landed on a different node than
 * the first.
 *
 * We detect the gesture ourselves: if two clicks land on the same logical
 * `key` within `RAPID_CLICK_MS`, treat the second as "open". This keeps
 * native single-click selection (`click` still fires for the first click)
 * while making "double-click to open" reliable across recycling.
 */
const RAPID_CLICK_MS = 400;
let lastClickKey: string | null = null;
let lastClickAt = 0;

function onItemClick(item: FlatItem): void {
  selectedKey.value = item.key;
  focusedKey.value = item.key;

  const now = performance.now();
  if (lastClickKey === item.key && now - lastClickAt < RAPID_CLICK_MS) {
    // Reset so a third rapid click doesn't immediately fire another open
    // (e.g. user accidentally clicked four times — they get exactly one open).
    lastClickKey = null;
    lastClickAt = 0;
    activateItem(item);
    return;
  }
  lastClickKey = item.key;
  lastClickAt = now;
}

/**
 * Soft-delete the currently focused/selected item. Folders cascade to
 * their subtree via `tree.softDelete` (which also prunes the left panel);
 * files go through `filesApi.softDelete` and only need the right-panel
 * row pruned. Both share the same UX shell (confirm + spinner + neighbour
 * focus) so the only branch is "what to call".
 *
 * Errors are surfaced via `deleteError` rather than a `try/catch` that
 * swallows — silent failure on a destructive action is exactly the
 * "Debuggable" trap the project rules call out.
 */
const deletingKey = ref<string | null>(null);
const deleteError = ref<UiError | null>(null);

async function deleteItem(item: FlatItem): Promise<void> {
  const prompt =
    item.kind === 'folder'
      ? `Delete "${item.name}" and all its contents?\n\n` +
        `The folder will be soft-deleted and can be restored.`
      : `Delete "${item.name}"?\n\n` +
        `The file will be soft-deleted and can be restored.`;
  const ok = typeof window !== 'undefined' ? window.confirm(prompt) : false;
  if (!ok) return;

  // Capture restore context BEFORE the delete mutates state. For folders the
  // parent is the currently-viewed folder (we got the row from this view's
  // contents), or `null` when we're at the root listing.
  const parentId = selectedFolderId.value ?? null;
  const deletedKind = item.kind;
  const deletedId = item.id;
  const deletedName = item.name;

  deletingKey.value = item.key;
  deleteError.value = null;
  try {
    if (item.kind === 'folder') {
      await tree.softDelete(item.id);
      removeFolder(item.id);
    } else {
      await filesApi.softDelete(item.id);
      removeFile(item.id);
    }
  } catch (err) {
    deleteError.value = normalizeUiError(err, `delete.${item.kind}`);
    return;
  } finally {
    deletingKey.value = null;
  }

  // Shift focus/selection to a neighbor so keyboard flow doesn't jump to top.
  const remaining = items.value;
  const fallback = remaining[0] ?? null;
  selectedKey.value = null;
  focusedKey.value = fallback?.key ?? null;

  // Undo toast: the destructive action is reversible at the data layer
  // (soft-delete), so we owe the user a one-click way back. The toast store
  // owns the busy state + error fallback; we just provide the work to run.
  toasts.show({
    message: `${deletedKind === 'folder' ? 'Folder' : 'File'} "${deletedName}" deleted.`,
    variant: 'success',
    action: {
      label: 'Undo',
      async onActivate() {
        if (deletedKind === 'folder') {
          await tree.restoreFolder(deletedId, parentId);
        } else {
          await filesApi.restore(deletedId);
        }
        await refresh();
      },
    },
  });
}

const selectedItem = computed<FlatItem | null>(() =>
  selectedKey.value ? items.value.find((i) => i.key === selectedKey.value) ?? null : null,
);
const canDeleteSelection = computed(() => selectedItem.value !== null);

/**
 * Keyboard handling for the grid. Arrow/Home/End navigation is delegated to
 * `useGridKeyboardNav`; only the panel-specific shortcuts (activate, delete)
 * live here. Adding a new shortcut = one new key in the handlers map.
 */
function activateCurrent(current: FlatItem, e: KeyboardEvent): void {
  e.preventDefault();
  selectedKey.value = current.key;
  activateItem(current);
}

function handleDeleteShortcut(current: FlatItem, _i: number, e: KeyboardEvent): void {
  e.preventDefault();
  void deleteItem(current);
}

const { handle: onItemKeydown } = useGridKeyboardNav<FlatItem>({
  items,
  cols: columns,
  onFocus: focusIndex,
  handlers: {
    Enter: (current, _i, e) => activateCurrent(current, e),
    ' ': (current, _i, e) => activateCurrent(current, e),
    Delete: handleDeleteShortcut,
  },
});

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
 * Target tile width (px). Columns are picked as `floor(container /
 * TARGET_TILE_WIDTH)`, clamped to `[1, MAX_COLUMNS]`. Chosen so tiles stay
 * readable (name + modified-date) across the whole left-panel resize
 * range. If you change tile content size, revisit both numbers together.
 */
const TARGET_TILE_WIDTH = 220;
const MAX_COLUMNS = 8;

function recomputeColumns(width: number): void {
  if (!Number.isFinite(width) || width <= 0) {
    columns.value = 1;
    containerWidth.value = 0;
    return;
  }
  containerWidth.value = width;
  const next = Math.max(1, Math.min(MAX_COLUMNS, Math.floor(width / TARGET_TILE_WIDTH)));
  if (next !== columns.value) columns.value = next;
}

/**
 * Per-tile width handed to `<RecycleScroller :item-secondary-size>`.
 *
 * Why this exists (rp1/rp2): vue-virtual-scroller's grid mode falls back
 * to `itemSize` for the tile's *width* when `itemSecondarySize` is not
 * provided. With our `item-size="84"` (the tile's HEIGHT), that meant
 * every tile was frozen at 84 px wide — tiles looked like icons-only
 * squares and packed at the left while the rest of the panel sat empty.
 * Computing `floor(containerWidth / columns)` forces the grid to actually
 * fill the available width and respond to the left-panel splitter (rp3).
 *
 * `- 1` leaves a hair of breathing room so rounding doesn't trigger
 * horizontal overflow inside the scroller.
 */
const itemSecondarySize = computed(() => {
  if (containerWidth.value <= 0) return TARGET_TILE_WIDTH;
  const w = Math.max(80, Math.floor(containerWidth.value / columns.value) - 1);
  return w;
});

/**
 * The grid container only exists inside the `v-else` branch — i.e. *after*
 * `loading` flips off and `items.length > 0`. We can't observe it inside
 * `onMounted` because the ref is still `null` at that point; the early
 * return there used to leave `containerWidth = 0` forever, so
 * `itemSecondarySize` fell back to `TARGET_TILE_WIDTH` and `columns`
 * stayed at 1 — the "right panel only shows one tile per row" symptom.
 *
 * Watching the ref instead means: every time the container mounts (initial
 * load, navigating to a non-empty folder after an empty one, recovering
 * from an error), we attach a fresh ResizeObserver and immediately seed
 * `containerWidth` synchronously so the first paint is correct.
 */
let resizeObserver: ResizeObserver | null = null;
function attachResizeObserver(el: HTMLElement): void {
  resizeObserver?.disconnect();
  recomputeColumns(el.clientWidth);
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // `contentRect.width` excludes padding, which is what we want for
      // sizing tiles inside the scroll area.
      recomputeColumns(entry.contentRect.width);
    }
  });
  resizeObserver.observe(el);
}

watch(
  scrollerContainer,
  (el) => {
    if (typeof window === 'undefined') return;
    if (el) {
      attachResizeObserver(el);
    } else {
      resizeObserver?.disconnect();
      resizeObserver = null;
    }
  },
  { immediate: true, flush: 'post' },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
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
        class="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"
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
        v-if="deleteError"
        class="mb-2 flex shrink-0 items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        role="alert"
        data-testid="content-delete-error"
      >
        <div>
          <div class="font-medium">{{ deleteError.message }}</div>
          <div class="text-[11px] text-red-600/80">
            {{ deleteError.code }} · op: {{ deleteError.op }}
            <span v-if="deleteError.requestId"> · req: {{ deleteError.requestId }}</span>
          </div>
        </div>
        <button
          type="button"
          class="rounded px-1 text-red-600 hover:bg-red-100"
          aria-label="Dismiss error"
          @click="deleteError = null"
        >
          ×
        </button>
      </div>

      <div
        class="mb-2 flex shrink-0 items-center justify-end gap-2"
        role="toolbar"
        aria-label="Content actions"
      >
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-red-300 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
          :disabled="!canDeleteSelection || deletingKey !== null"
          :title="
            canDeleteSelection
              ? `Delete selected ${selectedItem?.kind ?? 'item'} (Delete)`
              : 'Select an item to delete'
          "
          data-testid="content-delete"
          @click="() => selectedItem && deleteItem(selectedItem)"
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
        ref="scrollerContainer"
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
          :item-secondary-size="itemSecondarySize"
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
            class="m-2 flex items-center gap-3 rounded-lg border bg-white p-3 shadow-sm transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
            :class="[
              selectedKey === item.key
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-slate-200 hover:border-emerald-300 hover:shadow',
            ]"
            @click="onItemClick(item)"
            @focus="focusedKey = item.key"
            @keydown="onItemKeydown($event, index)"
          >
            <Folder
              v-if="item.kind === 'folder'"
              class="h-8 w-8 text-emerald-500 flex-shrink-0"
              aria-hidden="true"
            />
            <component
              :is="fileIconFor(item.name).icon"
              v-else
              class="h-8 w-8 flex-shrink-0"
              :class="fileIconFor(item.name).color"
              aria-hidden="true"
            />
            <!--
              `flex-1 min-w-0` is non-negotiable (rp1): without `min-w-0` a
              flex child defaults to `min-content` width, which with a
              `truncate` span is the span's intrinsic (un-wrappable) width
              — so the text either overflows the tile invisibly or
              (depending on layout) collapses and the name looks blank.
              The parent `overflow-hidden` alone isn't enough; the *item*
              needs `min-width: 0` to let flex actually shrink.
            -->
            <div class="flex flex-col flex-1 min-w-0">
              <span class="truncate font-medium text-slate-900">{{ item.name }}</span>
              <span class="truncate text-xs text-slate-500">
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
          class="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
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
