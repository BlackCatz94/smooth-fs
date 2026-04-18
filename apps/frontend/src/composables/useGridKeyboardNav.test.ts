import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useGridKeyboardNav } from './useGridKeyboardNav';

function makeEvent(key: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key });
  e.preventDefault = vi.fn();
  return e;
}

describe('useGridKeyboardNav', () => {
  it('ArrowRight/Left move within the row and clamp at edges', () => {
    const items = ref(['a', 'b', 'c', 'd']);
    const cols = ref(2);
    const onFocus = vi.fn();
    const { handle } = useGridKeyboardNav<string>({ items, cols, onFocus });

    handle(makeEvent('ArrowRight'), 0);
    expect(onFocus).toHaveBeenLastCalledWith(1);

    handle(makeEvent('ArrowRight'), 3);
    expect(onFocus).toHaveBeenLastCalledWith(3);

    handle(makeEvent('ArrowLeft'), 2);
    expect(onFocus).toHaveBeenLastCalledWith(1);

    handle(makeEvent('ArrowLeft'), 0);
    expect(onFocus).toHaveBeenLastCalledWith(0);
  });

  it('ArrowDown/Up move by `cols` and clamp at grid boundaries', () => {
    const items = ref(Array.from({ length: 10 }, (_, i) => `i${i}`));
    const cols = ref(3);
    const onFocus = vi.fn();
    const { handle } = useGridKeyboardNav<string>({ items, cols, onFocus });

    handle(makeEvent('ArrowDown'), 1);
    expect(onFocus).toHaveBeenLastCalledWith(4);

    // Clamp at tail, not beyond.
    handle(makeEvent('ArrowDown'), 8);
    expect(onFocus).toHaveBeenLastCalledWith(9);

    handle(makeEvent('ArrowUp'), 4);
    expect(onFocus).toHaveBeenLastCalledWith(1);

    handle(makeEvent('ArrowUp'), 1);
    expect(onFocus).toHaveBeenLastCalledWith(0);
  });

  it('Home jumps to index 0, End jumps to last index', () => {
    const items = ref(['a', 'b', 'c']);
    const cols = ref(1);
    const onFocus = vi.fn();
    const { handle } = useGridKeyboardNav<string>({ items, cols, onFocus });

    handle(makeEvent('Home'), 2);
    expect(onFocus).toHaveBeenLastCalledWith(0);

    handle(makeEvent('End'), 0);
    expect(onFocus).toHaveBeenLastCalledWith(2);
  });

  it('is a no-op on empty list or out-of-range index', () => {
    const onFocus = vi.fn();
    const { handle: emptyHandle } = useGridKeyboardNav<string>({
      items: ref([]),
      cols: ref(2),
      onFocus,
    });
    emptyHandle(makeEvent('ArrowRight'), 0);
    expect(onFocus).not.toHaveBeenCalled();

    const { handle } = useGridKeyboardNav<string>({
      items: ref(['a']),
      cols: ref(1),
      onFocus,
    });
    handle(makeEvent('ArrowRight'), 99);
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('custom handlers intercept keys and preempt grid navigation', () => {
    const items = ref(['a', 'b', 'c']);
    const cols = ref(1);
    const onFocus = vi.fn();
    const onEnter = vi.fn();

    const { handle } = useGridKeyboardNav<string>({
      items,
      cols,
      onFocus,
      handlers: {
        Enter: (item, i) => onEnter(item, i),
      },
    });

    const e = makeEvent('Enter');
    handle(e, 1);
    expect(onEnter).toHaveBeenCalledWith('b', 1);
    // Grid fallback must NOT have fired.
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('custom handler returning `false` falls through to default grid motion', () => {
    const items = ref(['a', 'b']);
    const cols = ref(1);
    const onFocus = vi.fn();
    const delHandler = vi.fn().mockReturnValue(false);

    const { handle } = useGridKeyboardNav<string>({
      items,
      cols,
      onFocus,
      handlers: { Delete: delHandler },
    });

    handle(makeEvent('Delete'), 0);
    expect(delHandler).toHaveBeenCalled();
    // Delete isn't a built-in motion key, so fall-through does nothing.
    expect(onFocus).not.toHaveBeenCalled();

    // But ArrowRight with a fall-through handler should still move focus.
    const arrHandler = vi.fn().mockReturnValue(false);
    const { handle: handle2 } = useGridKeyboardNav<string>({
      items,
      cols,
      onFocus,
      handlers: { ArrowRight: arrHandler },
    });
    handle2(makeEvent('ArrowRight'), 0);
    expect(arrHandler).toHaveBeenCalled();
    expect(onFocus).toHaveBeenLastCalledWith(1);
  });

  it('clamps cols to at least 1 so a transient 0 does not divide-by-zero', () => {
    const items = ref(['a', 'b', 'c']);
    const cols = ref(0);
    const onFocus = vi.fn();
    const { handle } = useGridKeyboardNav<string>({ items, cols, onFocus });

    // With cols=1 semantics, ArrowDown from index 0 should land on index 1.
    handle(makeEvent('ArrowDown'), 0);
    expect(onFocus).toHaveBeenLastCalledWith(1);
  });
});
