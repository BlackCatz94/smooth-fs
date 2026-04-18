import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useDebounced } from './useDebounce';

/**
 * `useDebounced` uses `onBeforeUnmount`, so we host it inside a Vue component
 * to exercise the lifecycle cleanup path. Otherwise the composable's watcher
 * and the `onBeforeUnmount` hook would never trigger correctly.
 */
function mountHost<T>(source: { value: T }, ms?: number) {
  let exposed: { debounced: { value: T } } | null = null;
  const Host = defineComponent({
    setup() {
      const debounced = useDebounced(source as Parameters<typeof useDebounced<T>>[0], ms);
      exposed = { debounced };
      return () => h('div');
    },
  });
  const wrapper = mount(Host);
  return { wrapper, get debounced() { return exposed!.debounced; } };
}

describe('useDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mirrors the initial source value synchronously', () => {
    const src = ref('hello');
    const { debounced } = mountHost(src);
    expect(debounced.value).toBe('hello');
  });

  it('propagates a change only after the debounce window elapses', async () => {
    const src = ref('a');
    const { debounced } = mountHost(src, 200);

    src.value = 'b';
    await nextTick();
    expect(debounced.value).toBe('a');

    vi.advanceTimersByTime(199);
    expect(debounced.value).toBe('a');

    vi.advanceTimersByTime(1);
    expect(debounced.value).toBe('b');
  });

  it('collapses rapid successive writes into a single trailing update', async () => {
    const src = ref('');
    const { debounced } = mountHost(src, 100);

    for (const ch of 'abcd') {
      src.value += ch;
      await nextTick();
      vi.advanceTimersByTime(50);
    }

    // Still within the last debounce window after four 50ms ticks.
    expect(debounced.value).toBe('');
    vi.advanceTimersByTime(100);
    expect(debounced.value).toBe('abcd');
  });

  it('cancels the pending timer when the host unmounts', async () => {
    const src = ref('x');
    const { wrapper, debounced } = mountHost(src, 100);

    src.value = 'y';
    await nextTick();
    wrapper.unmount();

    vi.advanceTimersByTime(1000);
    // Unmount cleared the timer, so the debounced ref must not flip to 'y'.
    expect(debounced.value).toBe('x');
  });
});
