import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
  LIST_MAX_LIMIT,
  type FolderNode,
  type FileNode,
} from '@smoothfs/shared';
import { foldersApi } from '@/lib/api/folders';
import { normalizeUiError, type UiError } from '@/lib/api/error';

/**
 * Right-panel contents loader.
 *
 * Responsibilities:
 *  - Fetch `folders + files` for `selectedFolderId` via `/folders/:id/contents`.
 *  - **Guard against stale responses** when the user clicks fast between
 *    folders: an `AbortController` cancels the in-flight fetch, and a
 *    sequence token drops any response that completes out-of-order anyway.
 *  - Expose cursor pagination (`loadMoreFolders`, `loadMoreFiles`) so the
 *    grid isn't silently capped at the first server page.
 */
export interface UseContentsReturn {
  readonly folders: Ref<FolderNode[]>;
  readonly files: Ref<FileNode[]>;
  readonly loading: Ref<boolean>;
  readonly loadingMore: ComputedRef<boolean>;
  readonly loadingMoreFolders: Ref<boolean>;
  readonly loadingMoreFiles: Ref<boolean>;
  readonly hasMoreFolders: Ref<boolean>;
  readonly hasMoreFiles: Ref<boolean>;
  readonly error: Ref<UiError | null>;
  loadMoreFolders(): Promise<void>;
  loadMoreFiles(): Promise<void>;
  /**
   * Optimistic local removal used after a successful soft-delete, so the
   * right panel drops the row without a round-trip.
   */
  removeFolder(id: string): void;
  /**
   * Counterpart to `removeFolder` for individual file deletes (DELETE
   * `/api/v1/files/:id`).
   */
  removeFile(id: string): void;
  /**
   * Re-fetch the current folder's contents, replacing any in-memory state.
   * Used after Undo (restore) so the restored row reappears in alphabetical
   * order. Inserting locally would require duplicating the server's sort and
   * cursor reconciliation; a single round-trip is correct, simple, and tiny
   * compared to the user-perceived cost of the destructive action it follows.
   */
  refresh(): Promise<void>;
}

export function useContents(selectedFolderId: () => string | undefined): UseContentsReturn {
  const folders = ref<FolderNode[]>([]);
  const files = ref<FileNode[]>([]);
  const loading = ref(false);
  const error = ref<UiError | null>(null);

  const foldersCursor = ref<string | null>(null);
  const filesCursor = ref<string | null>(null);
  const hasMoreFolders = ref(false);
  const hasMoreFiles = ref(false);
  const loadingMoreFolders = ref(false);
  const loadingMoreFiles = ref(false);
  const loadingMore = computed(() => loadingMoreFolders.value || loadingMoreFiles.value);

  // Sequence token + AbortController: either alone is insufficient. The
  // controller cancels network work eagerly; the token drops any response
  // that still slipped through (e.g. schema-parse finishing after abort).
  let activeToken = 0;
  let activeController: AbortController | null = null;
  let activeFolderId: string | undefined;

  function abortActive(): void {
    activeController?.abort();
    activeController = null;
  }

  /**
   * Run a fresh "first-page" fetch for `id` (or clear state when id is
   * undefined). Centralised so both the `selectedFolderId` watcher and the
   * public `refresh()` go through the same abort + token discipline — the
   * stale-response guard only works if every fetch path uses it.
   */
  async function fetchInitial(id: string | undefined): Promise<void> {
    abortActive();

    activeFolderId = id;
    const myToken = ++activeToken;

    if (!id) {
      folders.value = [];
      files.value = [];
      foldersCursor.value = null;
      filesCursor.value = null;
      hasMoreFolders.value = false;
      hasMoreFiles.value = false;
      error.value = null;
      loading.value = false;
      return;
    }

    const controller = new AbortController();
    activeController = controller;
    loading.value = true;
    error.value = null;
    try {
      const res = await foldersApi.getContents(
        id,
        { limit: LIST_MAX_LIMIT },
        { signal: controller.signal },
      );
      if (myToken !== activeToken) return;
      folders.value = [...res.data.folders.items];
      files.value = [...res.data.files.items];
      foldersCursor.value = res.data.folders.nextCursor;
      filesCursor.value = res.data.files.nextCursor;
      hasMoreFolders.value = res.data.folders.hasMore;
      hasMoreFiles.value = res.data.files.hasMore;
    } catch (err) {
      if (myToken !== activeToken) return;
      if (isAbort(err)) return;
      error.value = normalizeUiError(err, 'getContents');
      folders.value = [];
      files.value = [];
      foldersCursor.value = null;
      filesCursor.value = null;
      hasMoreFolders.value = false;
      hasMoreFiles.value = false;
    } finally {
      if (myToken === activeToken) loading.value = false;
    }
  }

  watch(selectedFolderId, fetchInitial, { immediate: true });

  async function refresh(): Promise<void> {
    await fetchInitial(selectedFolderId());
  }

  async function loadMoreFolders(): Promise<void> {
    const id = activeFolderId;
    if (!id || !hasMoreFolders.value || loadingMoreFolders.value) return;
    const cursor = foldersCursor.value;
    if (!cursor) return;

    const controller = new AbortController();
    const myToken = activeToken;
    loadingMoreFolders.value = true;
    try {
      const res = await foldersApi.getContents(
        id,
        { foldersCursor: cursor, filesCursor: null, limit: LIST_MAX_LIMIT },
        { signal: controller.signal },
      );
      if (myToken !== activeToken) return;
      folders.value = [...folders.value, ...res.data.folders.items];
      foldersCursor.value = res.data.folders.nextCursor;
      hasMoreFolders.value = res.data.folders.hasMore;
    } catch (err) {
      if (myToken !== activeToken || isAbort(err)) return;
      error.value = normalizeUiError(err, 'getContents.more');
    } finally {
      if (myToken === activeToken) loadingMoreFolders.value = false;
    }
  }

  async function loadMoreFiles(): Promise<void> {
    const id = activeFolderId;
    if (!id || !hasMoreFiles.value || loadingMoreFiles.value) return;
    const cursor = filesCursor.value;
    if (!cursor) return;

    const controller = new AbortController();
    const myToken = activeToken;
    loadingMoreFiles.value = true;
    try {
      const res = await foldersApi.getContents(
        id,
        { foldersCursor: null, filesCursor: cursor, limit: LIST_MAX_LIMIT },
        { signal: controller.signal },
      );
      if (myToken !== activeToken) return;
      files.value = [...files.value, ...res.data.files.items];
      filesCursor.value = res.data.files.nextCursor;
      hasMoreFiles.value = res.data.files.hasMore;
    } catch (err) {
      if (myToken !== activeToken || isAbort(err)) return;
      error.value = normalizeUiError(err, 'getContents.more');
    } finally {
      if (myToken === activeToken) loadingMoreFiles.value = false;
    }
  }

  function removeFolder(id: string): void {
    const next = folders.value.filter((f) => f.id !== id);
    if (next.length !== folders.value.length) {
      folders.value = next;
    }
  }

  function removeFile(id: string): void {
    const next = files.value.filter((f) => f.id !== id);
    if (next.length !== files.value.length) {
      files.value = next;
    }
  }

  return {
    folders,
    files,
    loading,
    loadingMore,
    loadingMoreFolders,
    loadingMoreFiles,
    hasMoreFolders,
    hasMoreFiles,
    error,
    loadMoreFolders,
    loadMoreFiles,
    removeFolder,
    removeFile,
    refresh,
  };
}

function isAbort(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true;
  // Our ApiClientError surfaces abort-from-external-signal as 'ABORTED'.
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ABORTED'
  ) {
    return true;
  }
  return false;
}
