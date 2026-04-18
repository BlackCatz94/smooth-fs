import { z } from 'zod';

/**
 * Shape of what we keep across refreshes. Version-bump the schema if the tree
 * model changes so we don't blow up on stale payloads — we prefer dropping an
 * unrecognized blob to crashing on startup.
 */
const PERSIST_VERSION = 1;
const STORAGE_KEY = 'smoothfs.tree.state.v1';

const persistedSchema = z.object({
  version: z.literal(PERSIST_VERSION),
  selectedId: z.string().nullable(),
  expanded: z.array(z.string()),
});

export interface PersistedTreeState {
  selectedId: string | null;
  expanded: string[];
}

export function loadPersistedState(): PersistedTreeState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = persistedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      // Stale / corrupted payload — clear it so we don't keep retrying.
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      selectedId: parsed.data.selectedId,
      expanded: parsed.data.expanded,
    };
  } catch {
    return null;
  }
}

export function savePersistedState(state: PersistedTreeState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: PERSIST_VERSION,
        selectedId: state.selectedId,
        expanded: state.expanded,
      }),
    );
  } catch {
    // Quota exceeded or disabled storage — non-fatal; the next call will retry.
  }
}

export function clearPersistedState(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
