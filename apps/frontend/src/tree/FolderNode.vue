<script setup lang="ts">
import { computed } from 'vue';
import { ChevronRight, ChevronDown, Folder } from 'lucide-vue-next';
import type { VisibleRow } from './flattenVisibleRows';

const props = defineProps<{
  row: VisibleRow;
  isSelected: boolean;
  isFocused: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle', id: string): void;
  (e: 'select', id: string): void;
  (e: 'focus'): void;
}>();

// Per-depth indent halved (0.75rem, was 1.5rem) so deep trees stay usable
// without immediately needing horizontal scroll. Kept in sync with
// `FolderTree.vue`'s `INDENT_REM` constant — the tree uses it to size the
// horizontal-scroll container.
const paddingLeft = computed(() => `${props.row.depth * 0.75 + 0.5}rem`);

/**
 * Roving focus: only the focused row gets `tabindex=0`; every other row is
 * `tabindex=-1` so a single Tab press enters/exits the tree rather than
 * stepping through every visible row.
 */
const tabIndex = computed(() => (props.isFocused ? 0 : -1));

/**
 * Per WAI-ARIA: `aria-expanded` is only valid on treeitems that can be
 * expanded. Confirmed leaves (children fetched + empty) omit it entirely.
 */
const ariaExpanded = computed<boolean | undefined>(() =>
  props.row.isLeaf ? undefined : props.row.isExpanded,
);

function onToggle(e: Event): void {
  e.stopPropagation();
  emit('toggle', props.row.id);
}

function onSelect(): void {
  emit('select', props.row.id);
}

function onFocus(): void {
  emit('focus');
}
</script>

<template>
  <div
    class="flex h-8 w-full items-center cursor-pointer select-none border-b border-transparent transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-inset"
    :class="{ 'bg-sky-100 text-sky-900': isSelected }"
    :style="{ paddingLeft }"
    :data-tree-item-id="props.row.id"
    role="treeitem"
    :aria-expanded="ariaExpanded"
    :aria-selected="isSelected"
    :aria-level="props.row.depth + 1"
    :tabindex="tabIndex"
    @click="onSelect"
    @focus="onFocus"
  >
    <button
      v-if="!props.row.isLeaf"
      class="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-200 focus:outline-none mr-1"
      tabindex="-1"
      :aria-label="props.row.isExpanded ? 'Collapse' : 'Expand'"
      @click="onToggle"
    >
      <ChevronDown
        v-if="props.row.isExpanded"
        class="h-4 w-4 text-slate-500"
      />
      <ChevronRight
        v-else
        class="h-4 w-4 text-slate-500"
      />
    </button>
    <span
      v-else
      class="mr-1 h-6 w-6 shrink-0"
      aria-hidden="true"
    />

    <Folder class="h-4 w-4 mr-2 text-sky-600 flex-shrink-0" />

    <span
      class="truncate text-[15px] font-medium"
      :class="isSelected ? 'text-sky-900' : 'text-slate-900'"
    >
      {{ props.row.node.name }}
    </span>

    <span
      v-if="props.row.isLoading"
      class="ml-2 h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent"
      aria-hidden="true"
    />
  </div>
</template>
