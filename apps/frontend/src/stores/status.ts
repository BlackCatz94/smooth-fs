import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * Status-bar state, written by the right panel and read by the shell footer.
 * Kept intentionally tiny — anything the status bar can't derive from here
 * belongs on a dedicated store rather than bloating this one.
 */
export const useStatusStore = defineStore('status', () => {
  const folderCount = ref(0);
  const fileCount = ref(0);
  const selectedName = ref<string | null>(null);

  function reset(): void {
    folderCount.value = 0;
    fileCount.value = 0;
    selectedName.value = null;
  }

  function setCounts(folders: number, files: number): void {
    folderCount.value = folders;
    fileCount.value = files;
  }

  function setSelected(name: string | null): void {
    selectedName.value = name;
  }

  return {
    folderCount,
    fileCount,
    selectedName,
    reset,
    setCounts,
    setSelected,
  };
});
