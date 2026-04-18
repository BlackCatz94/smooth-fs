<script setup lang="ts">
import { computed } from 'vue';
import { MoreHorizontal, Loader2 } from 'lucide-vue-next';

const props = defineProps<{
  depth: number;
  isLoading: boolean;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  (e: 'activate'): void;
  (e: 'focus'): void;
}>();

// Matches `FolderNode`'s indent step (see `FolderTree.INDENT_REM`).
const paddingLeft = computed(() => `${props.depth * 0.75 + 0.5}rem`);
const tabIndex = computed(() => (props.isFocused ? 0 : -1));

function onClick(e: MouseEvent): void {
  e.stopPropagation();
  emit('activate');
}

function onFocus(): void {
  emit('focus');
}
</script>

<template>
  <!--
    Marked `role="none"` so screen readers don't announce this sentinel as a
    folder. We keep it in the tree's focus roving so keyboard users can still
    reach it with ArrowDown and press Enter to load the next page.
  -->
  <div
    class="flex h-8 w-full items-center cursor-pointer select-none border-b border-transparent text-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-inset"
    :style="{ paddingLeft }"
    role="none"
    data-tree-load-more="true"
    :tabindex="tabIndex"
    @click="onClick"
    @focus="onFocus"
  >
    <span
      class="mr-1 flex h-6 w-6 items-center justify-center"
      aria-hidden="true"
    >
      <Loader2
        v-if="props.isLoading"
        class="h-4 w-4 animate-spin text-emerald-500"
      />
      <MoreHorizontal
        v-else
        class="h-4 w-4 text-emerald-500"
      />
    </span>
    <span class="truncate text-[13px] font-medium">
      {{ props.isLoading ? 'Loading more...' : 'Load more folders' }}
    </span>
  </div>
</template>
