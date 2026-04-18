<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Folder as FolderIcon, Loader2, AlertCircle } from 'lucide-vue-next';
import type { FolderNode } from '@smoothfs/shared';
import { foldersApi } from '@/lib/api/folders';
import { normalizeUiError, type UiError } from '@/lib/api/error';
import { useDebounced } from '@/composables/useDebounce';

/**
 * Debounced-as-you-type folder search with a keyboard-navigable dropdown.
 * Backend: `GET /api/v1/folders/search?q=...`. Results open a folder via the
 * router (deep-linkable). Query below 2 chars is ignored (matches the server
 * floor in `SearchFoldersService`).
 */
const MIN_QUERY = 2;
const MAX_RESULTS = 20;

const router = useRouter();

const rawQuery = ref('');
const debouncedQuery = useDebounced(rawQuery, 250);

const open = ref(false);
const loading = ref(false);
const results = ref<readonly FolderNode[]>([]);
const error = ref<UiError | null>(null);
const activeIndex = ref(0);

const rootRef = ref<HTMLDivElement | null>(null);
let seq = 0;

const trimmed = computed(() => rawQuery.value.trim());
const shouldSearch = computed(() => trimmed.value.length >= MIN_QUERY);

watch(debouncedQuery, async (q) => {
  const query = q.trim();
  if (query.length < MIN_QUERY) {
    results.value = [];
    error.value = null;
    loading.value = false;
    return;
  }
  const mySeq = ++seq;
  loading.value = true;
  error.value = null;
  try {
    const res = await foldersApi.search({
      q: query,
      limit: MAX_RESULTS,
    });
    if (mySeq !== seq) return;
    results.value = res.data.items;
    activeIndex.value = 0;
  } catch (err) {
    if (mySeq !== seq) return;
    error.value = normalizeUiError(err, 'search');
    results.value = [];
  } finally {
    if (mySeq === seq) loading.value = false;
  }
});

function onInput(next: string): void {
  rawQuery.value = next;
  open.value = true;
}

function onFocus(): void {
  open.value = true;
}

function selectResult(folder: FolderNode): void {
  router.push({ name: 'folders', params: { id: folder.id } });
  close();
}

function close(): void {
  open.value = false;
}

function onDocumentClick(e: MouseEvent): void {
  const root = rootRef.value;
  if (!root) return;
  if (root.contains(e.target as Node)) return;
  close();
}

function onKeydown(e: KeyboardEvent): void {
  if (!open.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (!results.value.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % results.value.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value =
      (activeIndex.value - 1 + results.value.length) % results.value.length;
  } else if (e.key === 'Enter') {
    const chosen = results.value[activeIndex.value];
    if (chosen) {
      e.preventDefault();
      selectResult(chosen);
    }
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
});

const showEmptyState = computed(
  () =>
    open.value &&
    shouldSearch.value &&
    !loading.value &&
    !error.value &&
    results.value.length === 0,
);
</script>

<template>
  <div
    ref="rootRef"
    class="relative"
  >
    <slot
      name="trigger"
      :value="rawQuery"
      :on-input="onInput"
      :on-focus="onFocus"
    />

    <div
      v-if="open && (shouldSearch || loading || error)"
      class="absolute right-0 top-full z-20 mt-1 w-80 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
      role="listbox"
      aria-label="Search results"
      data-testid="search-popover"
    >
      <div
        v-if="loading"
        class="flex items-center gap-2 px-3 py-2 text-sm text-slate-500"
      >
        <Loader2 class="h-4 w-4 animate-spin" />
        Searching...
      </div>

      <div
        v-else-if="error"
        class="flex items-start gap-2 px-3 py-2 text-sm text-red-600"
        role="alert"
      >
        <AlertCircle class="h-4 w-4 shrink-0" />
        <div>
          <div class="font-medium">{{ error.message }}</div>
          <div class="text-xs text-red-500">
            {{ error.code }}<span v-if="error.requestId"> · req: {{ error.requestId }}</span>
          </div>
        </div>
      </div>

      <ul
        v-else-if="results.length > 0"
        class="max-h-80 divide-y divide-slate-100 overflow-y-auto"
      >
        <li
          v-for="(folder, index) in results"
          :key="folder.id"
          role="option"
          :aria-selected="index === activeIndex"
          :class="[
            'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
            index === activeIndex ? 'bg-sky-50 text-sky-900' : 'text-slate-700 hover:bg-slate-50',
          ]"
          data-testid="search-result"
          @mouseenter="activeIndex = index"
          @mousedown.prevent="selectResult(folder)"
        >
          <FolderIcon
            class="h-4 w-4 shrink-0 text-sky-500"
            aria-hidden="true"
          />
          <span class="truncate">{{ folder.name }}</span>
        </li>
      </ul>

      <div
        v-else-if="showEmptyState"
        class="px-3 py-2 text-sm text-slate-500"
        data-testid="search-empty"
      >
        No folders match "{{ trimmed }}"
      </div>
    </div>
  </div>
</template>
