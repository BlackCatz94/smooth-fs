import { z } from 'zod';

/**
 * Shape of what we keep across refreshes. Version-bump the schema if the tree
 * model changes so we don't blow up on stale payloads — we prefer dropping an
 * unrecognized blob to crashing on startup.
 *
 * Error handling philosophy: localStorage failures (quota, disabled storage,
 * malformed JSON) must NEVER break the tree UI — rehydration is an
 * optimization, not correctness. But silently swallowing them is a debugging
 * nightmare ("my selection keeps disappearing" with zero signal anywhere).
 * We log at `warn` level instead so the failure is visible in the devtools
 * console without polluting production error-tracking systems.
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

/**
 * Seam for tests: capture warnings in assertions without coupling to Vitest's
 * console spy. Tests can override via `setPersistenceLogger`.
 */
export interface PersistenceLogger {
  warn(message: string, detail?: unknown): void;
}

let logger: PersistenceLogger = {
  warn(message, detail) {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      if (detail !== undefined) {
        console.warn(`[tree.persistence] ${message}`, detail);
      } else {
        console.warn(`[tree.persistence] ${message}`);
      }
    }
  },
};

export function setPersistenceLogger(next: PersistenceLogger): void {
  logger = next;
}

export function loadPersistedState(): PersistedTreeState | null {
  if (typeof localStorage === 'undefined') return null;

  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    // Disabled storage (Safari private mode, locked-down profile, etc).
    logger.warn('localStorage.getItem failed; rehydration skipped', err);
    return null;
  }
  if (!raw) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    // Corrupted blob — surface it instead of silently retrying forever.
    logger.warn('persisted tree state is not valid JSON; clearing', err);
    safeRemove();
    return null;
  }

  const parsed = persistedSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn(
      'persisted tree state failed schema validation; clearing',
      parsed.error.issues,
    );
    safeRemove();
    return null;
  }

  return {
    selectedId: parsed.data.selectedId,
    expanded: parsed.data.expanded,
  };
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
  } catch (err) {
    // Quota-exceeded (too many expanded ids) or disabled storage. Keep the
    // existing payload so a future, smaller state can still be written.
    logger.warn('localStorage.setItem failed; tree state not persisted', err);
  }
}

export function clearPersistedState(): void {
  if (typeof localStorage === 'undefined') return;
  safeRemove();
}

function safeRemove(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    logger.warn('localStorage.removeItem failed', err);
  }
}
