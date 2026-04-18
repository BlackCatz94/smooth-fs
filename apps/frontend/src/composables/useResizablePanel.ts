import { onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * Persistable, draggable panel-width state.
 *
 * Owns two concerns in one seam:
 *
 *   1. A reactive `width` in pixels, clamped to `[min, max]`.
 *   2. A pointer-driven drag handler (`onPointerDown`) that updates
 *      `width` while the user drags a splitter.
 *
 * Persistence is best-effort: if `localStorage` throws (private mode,
 * quota, SSR) we log once and keep running with the in-memory value.
 * We deliberately do NOT re-clamp the persisted value on load against
 * the current viewport — the caller (AppShell) clamps on every
 * viewport resize so a previously-wider panel collapses gracefully
 * on a small screen instead of being permanently truncated at load.
 *
 * SOLID: this composable is agnostic of the panel's *direction*
 * (horizontal only for now) and of the DOM layout that holds the
 * splitter — callers just bind `onPointerDown` to a handle element.
 * That keeps it trivially swappable in tests.
 */
export interface UseResizablePanelOptions {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly min: number;
  readonly max: number;
}

export interface UseResizablePanelReturn {
  readonly width: Ref<number>;
  readonly isDragging: Ref<boolean>;
  clamp(w: number): number;
  setWidth(w: number): void;
  onPointerDown(e: PointerEvent): void;
}

export function useResizablePanel(
  opts: UseResizablePanelOptions,
): UseResizablePanelReturn {
  const width = ref<number>(readPersisted(opts));
  const isDragging = ref(false);

  function clamp(w: number): number {
    if (Number.isNaN(w)) return opts.defaultWidth;
    return Math.min(opts.max, Math.max(opts.min, Math.round(w)));
  }

  function setWidth(w: number): void {
    width.value = clamp(w);
  }

  // Persist on change (debounced via watch scheduling; cheap enough to
  // write eagerly because each pointermove fires at most once per frame).
  watch(width, (next) => {
    try {
      localStorage.setItem(opts.storageKey, String(next));
    } catch {
      // Silent: persistence is best-effort. We already warned on first load.
    }
  });

  let startX = 0;
  let startWidth = 0;
  let activePointerId: number | null = null;

  function onPointerMove(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    const dx = e.clientX - startX;
    width.value = clamp(startWidth + dx);
  }

  function onPointerUp(e: PointerEvent): void {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    isDragging.value = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    // Best-effort release — `releasePointerCapture` throws if the target
    // never captured, e.g. when we up'd outside of the originating element.
    try {
      (e.target as Element | null)?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
  }

  function onPointerDown(e: PointerEvent): void {
    // Only react to primary button (mouse) / touch / pen. Right-click drags
    // would be surprising.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    activePointerId = e.pointerId;
    startX = e.clientX;
    startWidth = width.value;
    isDragging.value = true;
    try {
      (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      /* noop */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  });

  return { width, isDragging, clamp, setWidth, onPointerDown };
}

function readPersisted(opts: UseResizablePanelOptions): number {
  try {
    const raw = localStorage.getItem(opts.storageKey);
    if (!raw) return opts.defaultWidth;
    const n = Number(raw);
    if (!Number.isFinite(n)) return opts.defaultWidth;
    return Math.min(opts.max, Math.max(opts.min, Math.round(n)));
  } catch (err) {
    // One warn, not per-read, because this runs at setup.
    console.warn('useResizablePanel: failed to read persisted width', err);
    return opts.defaultWidth;
  }
}
