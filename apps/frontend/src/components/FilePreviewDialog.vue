<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { X, FileText } from 'lucide-vue-next';
import type { FileNode } from '@smoothfs/shared';

/**
 * Minimal, dependency-free modal. We don't pull in Headless UI just for this —
 * we trap focus inside the dialog, return focus to the opener on close, and
 * honour `Escape` per WAI-ARIA. Full-preview content is explicitly deferred;
 * the body states so unambiguously (clinical tone for healthcare users).
 */
const props = defineProps<{
  file: FileNode | null;
}>();

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
            <FileText
              class="h-5 w-5 text-slate-400 shrink-0"
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
            class="rounded p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
            aria-label="Close preview"
            data-testid="file-preview-close"
            @click="close"
          >
            <X class="h-5 w-5" />
          </button>
        </header>
        <div
          id="file-preview-desc"
          class="px-4 py-4 text-sm text-slate-700 space-y-3"
        >
          <p class="text-slate-600">
            File preview is not available yet. The file metadata is shown below; opening content
            will arrive in a later release.
          </p>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-600">
            <dt class="font-medium text-slate-500">Name</dt>
            <dd class="truncate text-slate-900">{{ file.name }}</dd>
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
