<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { Search, ChevronLeft, ChevronRight, ArrowUp } from 'lucide-vue-next';
import FolderTree from '@/tree/FolderTree.vue';
import ContentPanel from '@/components/ContentPanel.vue';

const route = useRoute();
const selectedFolderId = computed(() => route.params.id as string | undefined);
</script>

<template>
  <div class="flex h-screen w-full flex-col bg-slate-50 text-slate-900 font-sans overflow-hidden">
    <!-- Top Navigation Bar -->
    <header class="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm z-10">
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 font-semibold text-sky-600">
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
        <div class="h-6 w-px bg-slate-200 mx-2" />
        <div class="flex items-center gap-1 text-slate-500">
          <button
            class="rounded p-1 hover:bg-slate-100 disabled:opacity-50"
            title="Back"
            disabled
          >
            <ChevronLeft class="h-5 w-5" />
          </button>
          <button
            class="rounded p-1 hover:bg-slate-100 disabled:opacity-50"
            title="Forward"
            disabled
          >
            <ChevronRight class="h-5 w-5" />
          </button>
          <button
            class="rounded p-1 hover:bg-slate-100 disabled:opacity-50"
            title="Up"
            disabled
          >
            <ArrowUp class="h-5 w-5" />
          </button>
        </div>
        <div class="flex items-center gap-2 text-sm text-slate-600 ml-2">
          <!-- Breadcrumb placeholder -->
          <span>Root</span>
          <span v-if="selectedFolderId"> &gt; {{ selectedFolderId }}</span>
        </div>
      </div>
      <div class="relative w-64">
        <Search class="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
        <input
          type="text"
          placeholder="Search..."
          class="h-8 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
      </div>
    </header>

    <!-- Main Content Area -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left Panel: Directory Tree -->
      <aside class="w-72 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <FolderTree />
      </aside>

      <!-- Right Panel: Content View -->
      <main class="flex-1 overflow-y-auto bg-white">
        <ContentPanel />
      </main>
    </div>

    <!-- Status Bar -->
    <footer class="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 text-xs text-slate-500">
      <div>0 items</div>
      <div>Selected: None</div>
    </footer>
  </div>
</template>
