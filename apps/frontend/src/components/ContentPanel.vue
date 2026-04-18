<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useContents } from '@/composables/useContents';
import { Folder, FileText } from 'lucide-vue-next';
import type { FileNode } from '@smoothfs/shared';
import FilePreviewDialog from './FilePreviewDialog.vue';

/**
 * Right panel (content view). Matches the Windows Explorer paradigm:
 *   - Single click  -> select (highlight + status bar context).
 *   - Double click  -> folder: navigate; file: open preview dialog.
 *   - Enter/Space   -> same as double click on the focused tile.
 *   - Arrow keys    -> move focus between tiles (roving tabindex).
 *
 * File content preview is intentionally a placeholder in Phase 5 — the user
 * explicitly chose `frontend-open-placeholder` so the backend surface stays
 * unchanged and the UX affordance is explicit ("preview not available yet").
 */

const route = useRoute();
const router = useRouter();
const selectedFolderId = computed(() => route.params.id as string | undefined);

const { folders, files, loading, error } = useContents(() => selectedFolderId.value);

type ItemKind = 'folder' | 'file';
interface FlatItem {
  readonly key: string;
  readonly kind: ItemKind;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

/**
 * Flat iteration order for keyboard focus. Folders first (matches tree
 * hierarchy), then files, so arrow-key navigation mirrors the visual grid.
 */
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

/** Reset selection/focus when navigating between folders — old keys become stale. */
watch(selectedFolderId, () => {
  selectedKey.value = null;
  focusedKey.value = null;
});

/** First render of a populated folder gets focus on the first tile. */
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

function onItemKeydown(e: KeyboardEvent, index: number): void {
  const list = items.value;
  if (list.length === 0) return;
  const current = list[index];
  if (!current) return;

  switch (e.key) {
    case 'Enter':
    case ' ': {
      e.preventDefault();
      selectedKey.value = current.key;
      activateItem(current);
      break;
    }
    case 'ArrowRight':
    case 'ArrowDown': {
      e.preventDefault();
      const next = list[Math.min(index + 1, list.length - 1)];
      if (next) focusKey(next.key);
      break;
    }
    case 'ArrowLeft':
    case 'ArrowUp': {
      e.preventDefault();
      const prev = list[Math.max(index - 1, 0)];
      if (prev) focusKey(prev.key);
      break;
    }
    case 'Home': {
      e.preventDefault();
      const first = list[0];
      if (first) focusKey(first.key);
      break;
    }
    case 'End': {
      e.preventDefault();
      const last = list[list.length - 1];
      if (last) focusKey(last.key);
      break;
    }
  }
}

function focusKey(key: string): void {
  focusedKey.value = key;
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-content-item-key="${key}"]`);
    el?.focus({ preventScroll: false });
  });
}

function closePreview(): void {
  previewFile.value = null;
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
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      role="list"
      aria-label="Folder contents"
    >
      <div
        v-for="(item, index) in items"
        :key="item.key"
        :data-content-item-key="item.key"
        :data-content-item-kind="item.kind"
        role="listitem"
        :aria-selected="selectedKey === item.key"
        :tabindex="focusedKey === item.key ? 0 : -1"
        class="flex items-center gap-3 p-3 rounded-lg border bg-white shadow-sm transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-sky-500"
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
        <FileText
          v-else
          class="h-8 w-8 text-slate-400 flex-shrink-0"
          aria-hidden="true"
        />
        <div class="flex flex-col overflow-hidden">
          <span class="truncate font-medium text-slate-900">{{ item.name }}</span>
          <span class="text-xs text-slate-500">
            {{ new Date(item.updatedAt).toLocaleDateString() }}
          </span>
        </div>
      </div>
    </div>

    <FilePreviewDialog
      :file="previewFile"
      @close="closePreview"
    />
  </div>
</template>
