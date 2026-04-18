<script setup lang="ts">
import { computed } from 'vue';
import { Loader2, X, AlertCircle, CheckCircle2, Info } from 'lucide-vue-next';
import { useToastStore, type ToastVariant } from '@/stores/toasts';

/**
 * Reactively renders the toast queue from `useToastStore`.
 *
 * Accessibility notes:
 *   - The container is a `role="region" aria-label="Notifications"` so AT
 *     users get a stable landmark.
 *   - Info/success toasts go in a `role="status"` (aria-live polite) region
 *     so they don't interrupt screen-reader output mid-sentence.
 *   - Error toasts go in a `role="alert"` (aria-live assertive) region so
 *     they DO interrupt — destructive failure is the textbook case where the
 *     user must hear about it immediately.
 *   - Pointer hover and keyboard focus both pause the autoclose timer (no
 *     "the Undo button vanished while I was reaching for it" trap).
 *   - The action button is the FIRST focusable child inside each toast so a
 *     Tab from the body lands on it; Esc on the toast dismisses it.
 *
 * Layout: fixed bottom-right, max width capped so multi-line messages wrap
 * instead of stretching across the screen. Stacked vertically with a small
 * gap; newest at the bottom (matches Apple/Material conventions).
 */

const toasts = useToastStore();

const polite = computed(() => toasts.items.filter((t) => t.variant !== 'error'));
const assertive = computed(() => toasts.items.filter((t) => t.variant === 'error'));

function variantClasses(variant: ToastVariant): string {
  switch (variant) {
    case 'success':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900';
    case 'error':
      return 'border-red-300 bg-red-50 text-red-900';
    case 'info':
    default:
      return 'border-slate-300 bg-white text-slate-900';
  }
}

function onKeydown(id: number, e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    toasts.dismiss(id);
  }
}
</script>

<template>
  <div
    role="region"
    aria-label="Notifications"
    class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
  >
    <!--
      Two ARIA-live regions: assertive for errors (announce immediately),
      polite for everything else. Keeping them visually merged in one column
      while semantically separate is the standard pattern.
    -->
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      class="flex flex-col gap-2"
    >
      <div
        v-for="t in polite"
        :key="t.id"
        :data-testid="`toast-${t.id}`"
        :data-variant="t.variant"
        class="pointer-events-auto flex items-start gap-3 rounded-md border px-3 py-2 shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
        :class="variantClasses(t.variant)"
        tabindex="0"
        @mouseenter="toasts.pause(t.id)"
        @mouseleave="toasts.resume(t.id)"
        @focusin="toasts.pause(t.id)"
        @focusout="toasts.resume(t.id)"
        @keydown="onKeydown(t.id, $event)"
      >
        <CheckCircle2
          v-if="t.variant === 'success'"
          class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
          aria-hidden="true"
        />
        <Info
          v-else
          class="mt-0.5 h-4 w-4 shrink-0 text-slate-500"
          aria-hidden="true"
        />
        <div class="flex-1 min-w-0 text-sm break-words">{{ t.message }}</div>
        <button
          v-if="t.action"
          type="button"
          class="shrink-0 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="t.actionPending"
          :data-testid="`toast-action-${t.id}`"
          @click="toasts.activate(t.id)"
        >
          <Loader2
            v-if="t.actionPending"
            class="h-3 w-3 animate-spin"
            aria-hidden="true"
          />
          {{ t.action.label }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          aria-label="Dismiss notification"
          :data-testid="`toast-dismiss-${t.id}`"
          @click="toasts.dismiss(t.id)"
        >
          <X
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>

    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      class="flex flex-col gap-2"
    >
      <div
        v-for="t in assertive"
        :key="t.id"
        :data-testid="`toast-${t.id}`"
        :data-variant="t.variant"
        class="pointer-events-auto flex items-start gap-3 rounded-md border px-3 py-2 shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
        :class="variantClasses(t.variant)"
        tabindex="0"
        @mouseenter="toasts.pause(t.id)"
        @mouseleave="toasts.resume(t.id)"
        @focusin="toasts.pause(t.id)"
        @focusout="toasts.resume(t.id)"
        @keydown="onKeydown(t.id, $event)"
      >
        <AlertCircle
          class="mt-0.5 h-4 w-4 shrink-0 text-red-600"
          aria-hidden="true"
        />
        <div class="flex-1 min-w-0 text-sm break-words">{{ t.message }}</div>
        <button
          v-if="t.action"
          type="button"
          class="shrink-0 inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
          :disabled="t.actionPending"
          :data-testid="`toast-action-${t.id}`"
          @click="toasts.activate(t.id)"
        >
          <Loader2
            v-if="t.actionPending"
            class="h-3 w-3 animate-spin"
            aria-hidden="true"
          />
          {{ t.action.label }}
        </button>
        <button
          type="button"
          class="shrink-0 rounded p-1 text-red-400 hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
          aria-label="Dismiss notification"
          :data-testid="`toast-dismiss-${t.id}`"
          @click="toasts.dismiss(t.id)"
        >
          <X
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  </div>
</template>
