<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRight, Home } from 'lucide-vue-next';
import type { FolderNode } from '@smoothfs/shared';

/**
 * Root-first breadcrumb. Each segment navigates via `router.push` so the
 * browser history stays consistent with the tree selection. The root "home"
 * segment clears the selected folder (no `:id` param).
 */
const props = defineProps<{
  path: readonly FolderNode[];
  loading: boolean;
}>();

const router = useRouter();

const segments = computed(() => props.path);

function goHome(): void {
  router.push({ name: 'folders' });
}

function goTo(id: string): void {
  router.push({ name: 'folders', params: { id } });
}
</script>

<template>
  <nav
    class="flex min-w-0 items-center gap-1 text-sm text-slate-600"
    aria-label="Breadcrumb"
  >
    <button
      type="button"
      class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
      :aria-current="segments.length === 0 ? 'page' : undefined"
      @click="goHome"
    >
      <Home
        class="h-4 w-4 text-slate-500"
        aria-hidden="true"
      />
      <span>Root</span>
    </button>

    <template
      v-for="(segment, index) in segments"
      :key="segment.id"
    >
      <ChevronRight
        class="h-4 w-4 shrink-0 text-slate-400"
        aria-hidden="true"
      />
      <button
        type="button"
        class="max-w-[12rem] shrink min-w-0 truncate rounded px-1.5 py-0.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
        :class="index === segments.length - 1 ? 'font-medium text-slate-900' : ''"
        :aria-current="index === segments.length - 1 ? 'page' : undefined"
        :title="segment.name"
        @click="goTo(segment.id)"
      >
        {{ segment.name }}
      </button>
    </template>

    <span
      v-if="loading && segments.length === 0"
      class="ml-2 text-xs text-slate-400"
    >
      Loading...
    </span>
  </nav>
</template>
