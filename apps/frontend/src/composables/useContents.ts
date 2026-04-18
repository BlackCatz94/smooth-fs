import { ref, watch } from 'vue';
import { LIST_MAX_LIMIT, type FolderNode, type FileNode } from '@smoothfs/shared';
import { foldersApi } from '@/lib/api/folders';
import { normalizeUiError, type UiError } from '@/lib/api/error';

export function useContents(selectedFolderId: () => string | undefined) {
  const folders = ref<FolderNode[]>([]);
  const files = ref<FileNode[]>([]);
  const loading = ref(false);
  const error = ref<UiError | null>(null);

  watch(
    selectedFolderId,
    async (id) => {
      if (!id) {
        folders.value = [];
        files.value = [];
        error.value = null;
        return;
      }

      loading.value = true;
      error.value = null;
      try {
        // For the right-panel view we load one page per cursor (up to the
        // server cap). If/when users need to browse beyond the first page we
        // can add "load more" controls — Phase 4 scope keeps it simple.
        const res = await foldersApi.getContents(id, { limit: LIST_MAX_LIMIT });
        folders.value = res.data.folders.items;
        files.value = res.data.files.items;
      } catch (err) {
        error.value = normalizeUiError(err, 'getContents');
        folders.value = [];
        files.value = [];
      } finally {
        loading.value = false;
      }
    },
    { immediate: true },
  );

  return {
    folders,
    files,
    loading,
    error,
  };
}
