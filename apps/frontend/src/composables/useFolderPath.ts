import { ref, watch, type Ref } from 'vue';
import type { FolderNode } from '@smoothfs/shared';
import { foldersApi } from '@/lib/api/folders';
import { normalizeUiError, type UiError } from '@/lib/api/error';

/**
 * Root-first ancestry for `folderId`, used by the top-bar breadcrumb and the
 * "Up" button. Independent of the tree store so the breadcrumb still paints
 * when the ancestor nodes haven't been materialised yet. Stale responses are
 * dropped via a per-call sequence token (same pattern as `useContents`).
 */
export function useFolderPath(selectedFolderId: () => string | undefined): {
  readonly path: Ref<readonly FolderNode[]>;
  readonly loading: Ref<boolean>;
  readonly error: Ref<UiError | null>;
} {
  const path = ref<readonly FolderNode[]>([]);
  const loading = ref(false);
  const error = ref<UiError | null>(null);

  let activeId: string | undefined;

  watch(
    selectedFolderId,
    async (id) => {
      activeId = id;
      if (!id) {
        path.value = [];
        error.value = null;
        return;
      }
      const myId = id;
      loading.value = true;
      error.value = null;
      try {
        const res = await foldersApi.getPath(id);
        if (activeId !== myId) return;
        path.value = res.data.items;
      } catch (err) {
        if (activeId !== myId) return;
        error.value = normalizeUiError(err, 'getPath');
        path.value = [];
      } finally {
        if (activeId === myId) {
          loading.value = false;
        }
      }
    },
    { immediate: true },
  );

  return { path, loading, error };
}
