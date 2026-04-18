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

const paddingLeft = computed(() => `${props.depth * 1.5 + 0.5}rem`);
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
    class="flex h-8 w-full items-center cursor-pointer select-none border-b border-transparent text-sky-700 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-inset"
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
        class="h-4 w-4 animate-spin text-sky-500"
      />
      <MoreHorizontal
        v-else
        class="h-4 w-4 text-sky-500"
      />
    </span>
    <span class="truncate text-[13px] font-medium">
      {{ props.isLoading ? 'Loading more...' : 'Load more folders' }}
    </span>
  </div>
</template>
