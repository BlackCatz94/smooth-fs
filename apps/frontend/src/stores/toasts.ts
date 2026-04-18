import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Lightweight, transient notification stack.
 *
 * Why a Pinia store and not a composable that returns refs:
 *   - Toasts can be triggered from *anywhere* (any component, any composable,
 *     even from outside Vue's setup phase like an API error handler). A
 *     singleton store is the right shape for "fire-and-forget messages".
 *   - The host component (`<ToastHost />`) reactively renders this store; no
 *     prop drilling, no event bus.
 *
 * Why we don't use an off-the-shelf toast library:
 *   - The project rules ban pre-built tree libraries; we extend that spirit
 *     to all UI primitives that touch focus, ARIA, and animations. ~80 lines
 *     of our own code is cheaper than the dependency surface and gives us
 *     full control over the destructive-action "Undo" semantics that motivate
 *     this store in the first place.
 *
 * Lifecycle:
 *   1. `show(...)` enqueues a toast with a unique id and starts an autoclose
 *      timer. The timer is paused while the toast is hovered/focused (handled
 *      by `<ToastHost />`, which calls `pause`/`resume`). This prevents the
 *      classic UX bug where Undo disappears between "I want to click it" and
 *      "I move my hand to the mouse".
 *   2. The action handler can return a Promise; while pending, the toast is
 *      kept open and marked `actionPending: true` so the host can show a
 *      spinner. On settle: success dismisses, error replaces the toast with
 *      an error variant.
 *   3. `dismiss(id)` clears the timer and removes the toast.
 */

export type ToastVariant = 'info' | 'success' | 'error';

export interface ToastAction {
  readonly label: string;
  /**
   * Run when the user activates the action button. May return a promise; if
   * it rejects, the toast is replaced with an error variant carrying the
   * thrown message. If it resolves, the toast is auto-dismissed.
   */
  onActivate(): void | Promise<void>;
}

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly variant: ToastVariant;
  readonly action: ToastAction | null;
  readonly durationMs: number;
  /** True while a returned Promise from `action.onActivate()` is in flight. */
  readonly actionPending: boolean;
}

export interface ShowToastInput {
  readonly message: string;
  readonly variant?: ToastVariant;
  readonly action?: ToastAction;
  /**
   * How long the toast stays before auto-dismiss, in ms. Action-bearing
   * toasts default to 7000 (long enough to read + click); plain info defaults
   * to 4000. Pass `0` for "sticky until manually dismissed" — useful for
   * errors that block the user.
   */
  readonly durationMs?: number;
}

/**
 * Mirror of `Toast` without `readonly`, plus the bookkeeping fields the
 * store mutates (timers, pause accounting). Kept private to this file so
 * the public `Toast` shape stays immutable from the consumer's POV.
 */
interface InternalToast {
  id: number;
  message: string;
  variant: ToastVariant;
  action: ToastAction | null;
  durationMs: number;
  actionPending: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  startedAt: number;
}

const DEFAULT_DURATION_WITH_ACTION_MS = 7000;
const DEFAULT_DURATION_PLAIN_MS = 4000;

export const useToastStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([]);
  // We need mutable bookkeeping (timer handles, remaining time on pause)
  // that should NOT trigger reactivity. A side Map keeps the public list
  // shape clean while we still own the lifecycle data.
  const internals = new Map<number, InternalToast>();
  let nextId = 1;

  function clearTimer(t: InternalToast): void {
    if (t.timer !== null) {
      clearTimeout(t.timer);
      t.timer = null;
    }
  }

  function startTimer(t: InternalToast): void {
    clearTimer(t);
    if (t.remainingMs <= 0) return; // sticky
    t.startedAt = Date.now();
    t.timer = setTimeout(() => dismiss(t.id), t.remainingMs);
  }

  function syncPublic(): void {
    // Snapshot the public-facing fields so the reactive list reflects current
    // state (esp. `actionPending`). We assign a new array so Vue treats the
    // change as a list mutation rather than a per-item nudge.
    items.value = Array.from(internals.values()).map((t) => ({
      id: t.id,
      message: t.message,
      variant: t.variant,
      action: t.action,
      durationMs: t.durationMs,
      actionPending: t.actionPending,
    }));
  }

  function show(input: ShowToastInput): number {
    const id = nextId++;
    const variant: ToastVariant = input.variant ?? 'info';
    const action = input.action ?? null;
    const durationMs =
      input.durationMs ??
      (action !== null ? DEFAULT_DURATION_WITH_ACTION_MS : DEFAULT_DURATION_PLAIN_MS);

    const t: InternalToast = {
      id,
      message: input.message,
      variant,
      action,
      durationMs,
      actionPending: false,
      timer: null,
      remainingMs: durationMs,
      startedAt: Date.now(),
    };
    internals.set(id, t);
    syncPublic();
    startTimer(t);
    return id;
  }

  function dismiss(id: number): void {
    const t = internals.get(id);
    if (!t) return;
    clearTimer(t);
    internals.delete(id);
    syncPublic();
  }

  function dismissAll(): void {
    for (const t of internals.values()) clearTimer(t);
    internals.clear();
    syncPublic();
  }

  /**
   * Pause the autoclose timer for `id`. Called by `<ToastHost />` on
   * mouseenter / focusin so the user has unbounded time to read + decide
   * once they engage with the toast.
   */
  function pause(id: number): void {
    const t = internals.get(id);
    if (!t || t.timer === null) return;
    const elapsed = Date.now() - t.startedAt;
    t.remainingMs = Math.max(0, t.remainingMs - elapsed);
    clearTimer(t);
  }

  function resume(id: number): void {
    const t = internals.get(id);
    if (!t) return;
    startTimer(t);
  }

  /**
   * Trigger the toast's action. Owns the pending/spinner state and the
   * "auto-dismiss on success / replace with error toast on failure"
   * lifecycle so call sites in components stay declarative.
   */
  async function activate(id: number): Promise<void> {
    const t = internals.get(id);
    if (!t || t.action === null || t.actionPending) return;

    clearTimer(t);
    t.actionPending = true;
    syncPublic();

    try {
      await t.action.onActivate();
      dismiss(id);
    } catch (err) {
      dismiss(id);
      const msg =
        err instanceof Error && err.message
          ? `Undo failed: ${err.message}`
          : 'Undo failed. Please try again.';
      show({ message: msg, variant: 'error', durationMs: 6000 });
    }
  }

  return {
    items,
    show,
    dismiss,
    dismissAll,
    pause,
    resume,
    activate,
  };
});
