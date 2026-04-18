import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

/**
 * Returns a debounced companion ref for `source`. Writes to `source` are
 * propagated to the returned ref `ms` milliseconds after the last write —
 * ideal for "fire a search as the user stops typing". The timer clears on
 * component unmount so stale callbacks never fire after the page changes.
 */
export function useDebounced<T>(source: Ref<T>, ms = 250): Ref<T> {
  const debounced = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | null = null;

  watch(source, (next) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      debounced.value = next;
      timer = null;
    }, ms);
  });

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
  });

  return debounced;
}
