<script setup lang="ts">
import { ref } from 'vue';
import { Info, X } from 'lucide-vue-next';

/**
 * Thin "this is a public demo" hint shown only when `VITE_DEMO_MODE=true`.
 *
 * Design constraints:
 *  - Never bypassable for the visitor on the first paint — they SHOULD see
 *    it once so they don't mistake seeded fixture data for their own.
 *  - Dismissable per-tab: we use `sessionStorage` (not `localStorage`) so a
 *    returning visitor gets reminded after they come back.
 *  - Zero layout shift when dismissed: the banner collapses via `v-if`
 *    rather than opacity so it releases its height back to the shell.
 *
 * This component is a leaf: it owns its own dismiss state so `AppShell`
 * doesn't have to thread a ref through just to close a banner. Tests mount
 * it in isolation with controlled `sessionStorage`.
 */
const DISMISS_KEY = 'smoothfs.demo-banner.dismissed';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

const visible = ref(!readDismissed());

function dismiss(): void {
  visible.value = false;
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* best-effort — private mode / quota */
  }
}
</script>

<template>
  <div
    v-if="visible"
    role="status"
    aria-live="polite"
    data-testid="demo-banner"
    class="flex items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900"
  >
    <div class="flex min-w-0 items-center gap-2">
      <Info
        class="h-4 w-4 shrink-0 text-emerald-600"
        aria-hidden="true"
      />
      <span class="min-w-0 truncate">
        <strong class="font-semibold">Live demo.</strong>
        Seeded data resets on each deploy — feel free to click around,
        delete folders, try the undo toast.
      </span>
    </div>
    <button
      type="button"
      class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
      aria-label="Dismiss demo banner"
      @click="dismiss"
    >
      <X class="h-3.5 w-3.5" />
      <span>Dismiss</span>
    </button>
  </div>
</template>
