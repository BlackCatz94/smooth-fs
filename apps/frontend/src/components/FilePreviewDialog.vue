<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import type { FileNode } from '@smoothfs/shared';
import { fileIconFor, extensionOf } from '@/lib/fileIcon';

/**
 * Minimal, dependency-free modal. We don't pull in Headless UI just for this —
 * we trap focus inside the dialog, return focus to the opener on close, and
 * honour `Escape` per WAI-ARIA.
 *
 * This is intentionally an *info* dialog, not a content preview: SmoothFS
 * stores file nodes as metadata records (no blob storage), so rendering
 * "contents" would be misleading. We show the derived kind + icon + timestamps
 * so the user gets real information instead of a "not available yet" apology.
 */
const props = defineProps<{
  file: FileNode | null;
}>();

const iconInfo = computed(() => (props.file ? fileIconFor(props.file.name) : null));
const extension = computed(() => (props.file ? extensionOf(props.file.name) : ''));

const emit = defineEmits<{ (e: 'close'): void }>();

const dialogRef = ref<HTMLDivElement | null>(null);
const closeBtnRef = ref<HTMLButtonElement | null>(null);
let opener: HTMLElement | null = null;

function close(): void {
  emit('close');
}

function onKeydown(e: KeyboardEvent): void {
  if (!props.file) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key === 'Tab') {
    // Single focusable inside (close button) -> trap focus.
    e.preventDefault();
    closeBtnRef.value?.focus();
  }
}

watch(
  () => props.file,
  (file) => {
    if (file) {
      opener = (document.activeElement as HTMLElement | null) ?? null;
      requestAnimationFrame(() => closeBtnRef.value?.focus());
    } else if (opener) {
      opener.focus?.();
      opener = null;
    }
  },
);

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="file"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="presentation"
      data-testid="file-preview-backdrop"
      @click.self="close"
    >
      <div
        ref="dialogRef"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-preview-title"
        aria-describedby="file-preview-desc"
        class="w-full max-w-md rounded-lg bg-white shadow-xl"
        data-testid="file-preview-dialog"
      >
        <header class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div class="flex items-center gap-2 min-w-0">
            <component
              :is="iconInfo?.icon"
              v-if="iconInfo"
              class="h-5 w-5 shrink-0"
              :class="iconInfo.color"
              aria-hidden="true"
            />
            <h2
              id="file-preview-title"
              class="truncate text-[15px] font-semibold text-slate-900"
            >
              {{ file.name }}
            </h2>
          </div>
          <button
            ref="closeBtnRef"
            type="button"
            class="rounded p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            aria-label="Close details"
            data-testid="file-preview-close"
            @click="close"
          >
            <X class="h-5 w-5" />
          </button>
        </header>
        <div
          id="file-preview-desc"
          class="px-4 py-4 text-sm text-slate-700 space-y-4"
        >
          <div class="flex items-center gap-3">
            <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-slate-50">
              <component
                :is="iconInfo?.icon"
                v-if="iconInfo"
                class="h-9 w-9"
                :class="iconInfo.color"
                aria-hidden="true"
              />
            </div>
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-slate-900">{{ file.name }}</div>
              <div class="text-xs text-slate-500">
                {{ iconInfo?.label ?? 'File' }}<span v-if="extension"> · .{{ extension }}</span>
              </div>
            </div>
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-600">
            <dt class="font-medium text-slate-500">Created</dt>
            <dd class="text-slate-900">{{ new Date(file.createdAt).toLocaleString() }}</dd>
            <dt class="font-medium text-slate-500">Updated</dt>
            <dd class="text-slate-900">{{ new Date(file.updatedAt).toLocaleString() }}</dd>
            <dt class="font-medium text-slate-500">ID</dt>
            <dd class="truncate font-mono text-[11px] text-slate-700">{{ file.id }}</dd>
          </dl>
        </div>
      </div>
    </div>
  </Teleport>
</template>
