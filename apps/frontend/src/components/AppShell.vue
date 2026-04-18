<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, ChevronLeft, ChevronRight, ArrowUp } from 'lucide-vue-next';
import FolderTree from '@/tree/FolderTree.vue';
import ContentPanel from '@/components/ContentPanel.vue';
import Breadcrumb from '@/components/Breadcrumb.vue';
import SearchPopover from '@/components/SearchPopover.vue';
import { useFolderPath } from '@/composables/useFolderPath';
import { useStatusStore } from '@/stores/status';

const route = useRoute();
const router = useRouter();
const selectedFolderId = computed(() => route.params.id as string | undefined);

const { path, loading: pathLoading } = useFolderPath(() => selectedFolderId.value);
const status = useStatusStore();

/**
 * "Up" navigates to the parent folder — the second-to-last segment of the
 * current path. Disabled when there's no parent (at or above root).
 */
const parentFolder = computed(() => {
  const segments = path.value;
  if (segments.length < 2) return null;
  return segments[segments.length - 2] ?? null;
});

const canGoUp = computed(() => parentFolder.value !== null || !!selectedFolderId.value);

function goBack(): void {
  router.back();
}
function goForward(): void {
  router.forward();
}
function goUp(): void {
  const parent = parentFolder.value;
  if (parent) {
    router.push({ name: 'folders', params: { id: parent.id } });
  } else if (selectedFolderId.value) {
    router.push({ name: 'folders' });
  }
}

const itemsLabel = computed(() => {
  const folders = status.folderCount;
  const files = status.fileCount;
  if (folders === 0 && files === 0) return '0 items';
  const parts: string[] = [];
  parts.push(`${folders} ${folders === 1 ? 'folder' : 'folders'}`);
  parts.push(`${files} ${files === 1 ? 'file' : 'files'}`);
  return parts.join(', ');
});

const selectionLabel = computed(() => status.selectedName ?? 'None');
</script>

<template>
  <div class="flex h-screen w-full flex-col bg-slate-50 text-slate-900 font-sans overflow-hidden">
    <!-- Top Navigation Bar -->
    <header class="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 shadow-sm z-10">
      <div class="flex min-w-0 flex-1 items-center gap-4">
        <div class="flex shrink-0 items-center gap-2 font-semibold text-sky-600">
          <svg
            class="h-6 w-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M2 10v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V10" />
            <path d="M2 10l3-7a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 21 3l3 7" />
            <path d="M12 10v12" />
          </svg>
          SmoothFS
        </div>
        <div class="h-6 w-px shrink-0 bg-slate-200" />
        <div class="flex shrink-0 items-center gap-1 text-slate-500">
          <button
            type="button"
            class="rounded p-1 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            title="Back"
            aria-label="Back"
            @click="goBack"
          >
            <ChevronLeft class="h-5 w-5" />
          </button>
          <button
            type="button"
            class="rounded p-1 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            title="Forward"
            aria-label="Forward"
            @click="goForward"
          >
            <ChevronRight class="h-5 w-5" />
          </button>
          <button
            type="button"
            class="rounded p-1 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Up"
            aria-label="Up"
            :disabled="!canGoUp"
            @click="goUp"
          >
            <ArrowUp class="h-5 w-5" />
          </button>
        </div>
        <div class="min-w-0 flex-1">
          <Breadcrumb
            :path="path"
            :loading="pathLoading"
          />
        </div>
      </div>
      <div class="shrink-0">
        <SearchPopover>
          <template #trigger="{ onFocus, onInput, value }">
            <div class="relative w-64">
              <Search class="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search folders..."
                aria-label="Search folders"
                class="h-8 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                :value="value"
                @input="onInput(($event.target as HTMLInputElement).value)"
                @focus="onFocus"
              >
            </div>
          </template>
        </SearchPopover>
      </div>
    </header>

    <!-- Main Content Area -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left Panel: Directory Tree -->
      <aside class="w-72 shrink-0 border-r border-slate-200 bg-white overflow-hidden">
        <FolderTree />
      </aside>

      <!-- Right Panel: Content View -->
      <main class="flex-1 overflow-hidden bg-white">
        <ContentPanel />
      </main>
    </div>

    <!-- Status Bar -->
    <footer class="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 text-xs text-slate-500">
      <div>{{ itemsLabel }}</div>
      <div class="truncate">Selected: {{ selectionLabel }}</div>
    </footer>
  </div>
</template>
