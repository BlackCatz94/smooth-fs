<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Search, ChevronLeft, ChevronRight, ArrowUp } from 'lucide-vue-next';
import FolderTree from '@/tree/FolderTree.vue';
import ContentPanel from '@/components/ContentPanel.vue';
import Breadcrumb from '@/components/Breadcrumb.vue';
import SearchPopover from '@/components/SearchPopover.vue';
import AppLogo from '@/components/AppLogo.vue';
import ToastHost from '@/components/ToastHost.vue';
import { useFolderPath } from '@/composables/useFolderPath';
import { useResizablePanel } from '@/composables/useResizablePanel';
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

/**
 * Left-panel width (lp5). We use a px value rather than a Tailwind class so
 * the splitter can deliver sub-breakpoint granularity. Min/max are tuned so
 * the tree never collapses to unreadable and never starves the content
 * panel: below 160 px the chevron + icon barely fit; above ~40% of the
 * viewport the right panel starts to feel cramped.
 *
 * On very narrow viewports we also clamp down against the live viewport so
 * a previously-wider persisted value doesn't lock us into a broken layout.
 */
const MIN_PANEL = 160;
const MAX_PANEL = 640;
const DEFAULT_PANEL = 288; // matches the previous Tailwind `w-72`
const { width: leftPanelWidth, isDragging, clamp, setWidth, onPointerDown } =
  useResizablePanel({
    storageKey: 'smoothfs:leftPanelWidth',
    defaultWidth: DEFAULT_PANEL,
    min: MIN_PANEL,
    max: MAX_PANEL,
  });
const leftPanelStyle = computed(() => ({ width: `${leftPanelWidth.value}px` }));

function clampToViewport(): void {
  if (typeof window === 'undefined') return;
  // Never let the left panel eat more than ~55 % of the viewport so the
  // content panel stays usable. This runs on every viewport resize.
  const viewportCap = Math.floor(window.innerWidth * 0.55);
  const hardMax = Math.min(MAX_PANEL, Math.max(MIN_PANEL, viewportCap));
  if (leftPanelWidth.value > hardMax) setWidth(hardMax);
}

function onResizeHandleKey(e: KeyboardEvent): void {
  // Keyboard accessibility for the splitter: ArrowLeft/Right nudge 16 px,
  // Home/End snap to min/max. Matches WAI-ARIA separator keyboard model.
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    setWidth(clamp(leftPanelWidth.value - 16));
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    setWidth(clamp(leftPanelWidth.value + 16));
  } else if (e.key === 'Home') {
    e.preventDefault();
    setWidth(MIN_PANEL);
  } else if (e.key === 'End') {
    e.preventDefault();
    setWidth(MAX_PANEL);
  }
}

onMounted(() => {
  clampToViewport();
  window.addEventListener('resize', clampToViewport);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', clampToViewport);
});
</script>

<template>
  <div class="flex h-screen w-full flex-col bg-slate-50 text-slate-900 font-sans overflow-hidden">
    <!-- Top Navigation Bar -->
    <header class="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 border-t-4 border-t-emerald-500 bg-white px-4 shadow-sm z-10">
      <div class="flex min-w-0 flex-1 items-center gap-4">
        <div class="flex shrink-0 items-center gap-2 font-semibold text-slate-900">
          <AppLogo
            :size="26"
            title="SmoothFS"
          />
          SmoothFS
        </div>
        <div class="h-6 w-px shrink-0 bg-slate-200" />
        <div class="flex shrink-0 items-center gap-1 text-slate-500">
          <button
            type="button"
            class="rounded p-1 hover:bg-emerald-50 hover:text-emerald-700 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
            title="Back"
            aria-label="Back"
            @click="goBack"
          >
            <ChevronLeft class="h-5 w-5" />
          </button>
          <button
            type="button"
            class="rounded p-1 hover:bg-emerald-50 hover:text-emerald-700 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
            title="Forward"
            aria-label="Forward"
            @click="goForward"
          >
            <ChevronRight class="h-5 w-5" />
          </button>
          <button
            type="button"
            class="rounded p-1 hover:bg-emerald-50 hover:text-emerald-700 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
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
                class="h-8 w-full rounded-md border border-slate-300 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
    <div
      class="flex flex-1 overflow-hidden"
      :class="{ 'select-none cursor-col-resize': isDragging }"
    >
      <!--
        Left Panel: Directory Tree (lp5).
        Width is driven by `useResizablePanel`; Tailwind can't express a
        dynamic px value so we bind `style` directly. `shrink-0` is still
        essential so the flex layout respects our exact width instead of
        squeezing the panel when the content widens.
      -->
      <aside
        class="shrink-0 border-r border-slate-200 bg-white overflow-hidden"
        :style="leftPanelStyle"
      >
        <FolderTree />
      </aside>

      <!--
        Splitter. `role="separator"` + `aria-orientation="vertical"` is the
        WAI-ARIA pattern for a resize handle between horizontally-laid-out
        panels (the handle itself is vertical). We expose min/max/current
        via `aria-value*` so screen readers can announce drag progress.
      -->
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize folder panel"
        :aria-valuemin="MIN_PANEL"
        :aria-valuemax="MAX_PANEL"
        :aria-valuenow="leftPanelWidth"
        tabindex="0"
        class="relative w-1 shrink-0 cursor-col-resize bg-slate-200 hover:bg-emerald-400 focus:outline-none focus:bg-emerald-500 transition-colors"
        :class="{ 'bg-emerald-500': isDragging }"
        @pointerdown="onPointerDown"
        @keydown="onResizeHandleKey"
      >
        <!--
          Invisible wider hit target so users don't need pixel-precise aim.
          The visible bar stays 4 px; this overlay adds 3 px of grip on
          each side.
        -->
        <span
          class="absolute inset-y-0 -left-1 -right-1"
          aria-hidden="true"
        />
      </div>

      <!-- Right Panel: Content View -->
      <main class="flex-1 min-w-0 overflow-hidden bg-white">
        <ContentPanel />
      </main>
    </div>

    <!-- Status Bar -->
    <footer class="flex h-8 shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-4 text-xs text-slate-500">
      <div>{{ itemsLabel }}</div>
      <div class="truncate">Selected: {{ selectionLabel }}</div>
    </footer>

    <!--
      Toast layer is mounted last so it visually overlaps everything (z-50)
      and lives outside the flex column so it never steals layout space —
      eliminates the CLS bug where transient notifications would push the
      status bar down.
    -->
    <ToastHost />
  </div>
</template>
