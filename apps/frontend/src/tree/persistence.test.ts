import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadPersistedState,
  savePersistedState,
  clearPersistedState,
  setPersistenceLogger,
  type PersistenceLogger,
} from './persistence';

function makeSpyLogger(): PersistenceLogger & { calls: Array<{ message: string; detail: unknown }> } {
  const calls: Array<{ message: string; detail: unknown }> = [];
  return {
    calls,
    warn(message, detail) {
      calls.push({ message, detail });
    },
  };
}

describe('tree persistence', () => {
  let spy: ReturnType<typeof makeSpyLogger>;

  beforeEach(() => {
    localStorage.clear();
    spy = makeSpyLogger();
    setPersistenceLogger(spy);
  });

  afterEach(() => {
    // Restore the default console-based logger so leaks don't cross tests.
    setPersistenceLogger({
      warn(message, detail) {
        if (detail !== undefined) console.warn(`[tree.persistence] ${message}`, detail);
        else console.warn(`[tree.persistence] ${message}`);
      },
    });
  });

  it('returns null when nothing is persisted', () => {
    expect(loadPersistedState()).toBeNull();
    expect(spy.calls).toHaveLength(0);
  });

  it('round-trips selectedId and expanded ids', () => {
    savePersistedState({
      selectedId: 'abc',
      expanded: ['root', 'abc'],
    });

    const restored = loadPersistedState();
    expect(restored).not.toBeNull();
    expect(restored!.selectedId).toBe('abc');
    expect(restored!.expanded).toEqual(['root', 'abc']);
    expect(spy.calls).toHaveLength(0);
  });

  it('drops unrecognized / stale payloads and warns', () => {
    localStorage.setItem(
      'smoothfs.tree.state.v1',
      JSON.stringify({ version: 999, selectedId: 'x', expanded: [] }),
    );

    expect(loadPersistedState()).toBeNull();
    expect(localStorage.getItem('smoothfs.tree.state.v1')).toBeNull();
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.message).toContain('schema validation');
  });

  it('clearPersistedState removes the entry', () => {
    savePersistedState({ selectedId: 'a', expanded: ['b'] });
    clearPersistedState();
    expect(loadPersistedState()).toBeNull();
  });

  it('survives malformed JSON and warns instead of swallowing silently', () => {
    localStorage.setItem('smoothfs.tree.state.v1', '{not-json');
    expect(loadPersistedState()).toBeNull();
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.message).toContain('valid JSON');
    // And the malformed blob has been cleared so we don't loop on it.
    expect(localStorage.getItem('smoothfs.tree.state.v1')).toBeNull();
  });

  it('warns when setItem throws (quota / disabled storage)', () => {
    const original = localStorage.setItem.bind(localStorage);
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      value: () => {
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      },
    });
    try {
      savePersistedState({ selectedId: 'a', expanded: ['b'] });
      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]?.message).toContain('setItem failed');
    } finally {
      Object.defineProperty(localStorage, 'setItem', {
        configurable: true,
        value: original,
      });
    }
  });

  it('warns when getItem throws', () => {
    const original = localStorage.getItem.bind(localStorage);
    Object.defineProperty(localStorage, 'getItem', {
      configurable: true,
      value: () => {
        throw new Error('storage disabled');
      },
    });
    try {
      expect(loadPersistedState()).toBeNull();
      expect(spy.calls).toHaveLength(1);
      expect(spy.calls[0]?.message).toContain('getItem failed');
    } finally {
      Object.defineProperty(localStorage, 'getItem', {
        configurable: true,
        value: original,
      });
    }
  });
});
