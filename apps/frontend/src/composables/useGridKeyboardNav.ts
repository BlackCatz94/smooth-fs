import type { ComputedRef, Ref } from 'vue';

/**
 * 2D grid keyboard navigation primitive.
 *
 * Consumers pass a flat list of items plus the current column count (so the
 * composable works for both fixed and responsive grids). The returned
 * `handle(e, index)` takes care of the five universally-expected motion keys:
 *
 *   Arrow keys · Home · End
 *
 * Application-specific shortcuts (Enter, Space, Delete, F2 rename, …) are
 * registered via `handlers` — a map from `KeyboardEvent.key` to a callback.
 * This is the Open/Closed payoff: adding a new shortcut is a one-line map
 * edit, not a new `case` in a growing `switch`.
 *
 * Contract for custom handlers:
 *   - They OWN `e.preventDefault()` for their branch.
 *   - They return nothing (`void` / `undefined`) by default, which stops
 *     grid navigation from firing afterwards.
 *   - They MAY explicitly return `false` to signal "fall through" — the
 *     composable then runs its default motion handling for that key. In
 *     practice this is useful for conditional shortcuts (e.g. Delete only
 *     acts on folders; returning `false` for files lets the browser handle
 *     the key instead of silently swallowing it).
 */
export interface UseGridKeyboardNavOptions<T> {
  readonly items: Ref<readonly T[]> | ComputedRef<readonly T[]>;
  /** Reactive column count. Responsive grids re-emit a new value per layout. */
  readonly cols: Ref<number> | ComputedRef<number>;
  /** Called when grid navigation moves focus. `index` is the new target. */
  onFocus(index: number): void;
  /** Optional custom handlers keyed by `KeyboardEvent.key`. */
  readonly handlers?: Readonly<
    Record<string, (item: T, index: number, e: KeyboardEvent) => void | false>
  >;
}

export interface UseGridKeyboardNavReturn {
  handle(e: KeyboardEvent, index: number): void;
}

export function useGridKeyboardNav<T>(
  opts: UseGridKeyboardNavOptions<T>,
): UseGridKeyboardNavReturn {
  function handle(e: KeyboardEvent, index: number): void {
    const list = opts.items.value;
    if (list.length === 0) return;
    const current = list[index];
    if (!current) return;

    // Custom shortcuts run first so consumers can override any key if needed.
    // Returning `false` means "fall through to the built-in grid navigation".
    const custom = opts.handlers?.[e.key];
    if (custom) {
      const result = custom(current, index, e);
      if (result !== false) return;
    }

    const cols = Math.max(1, opts.cols.value);
    switch (e.key) {
      case 'ArrowRight': {
        e.preventDefault();
        opts.onFocus(Math.min(index + 1, list.length - 1));
        return;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        opts.onFocus(Math.max(index - 1, 0));
        return;
      }
      case 'ArrowDown': {
        e.preventDefault();
        opts.onFocus(Math.min(index + cols, list.length - 1));
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        opts.onFocus(Math.max(index - cols, 0));
        return;
      }
      case 'Home': {
        e.preventDefault();
        opts.onFocus(0);
        return;
      }
      case 'End': {
        e.preventDefault();
        opts.onFocus(list.length - 1);
        return;
      }
    }
  }

  return { handle };
}
