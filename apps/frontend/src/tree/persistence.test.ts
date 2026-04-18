import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPersistedState,
  savePersistedState,
  clearPersistedState,
} from './persistence';

describe('tree persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is persisted', () => {
    expect(loadPersistedState()).toBeNull();
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
  });

  it('drops unrecognized / stale payloads', () => {
    localStorage.setItem(
      'smoothfs.tree.state.v1',
      JSON.stringify({ version: 999, selectedId: 'x', expanded: [] }),
    );

    expect(loadPersistedState()).toBeNull();
    // And wipes the bad blob so we don't loop on it.
    expect(localStorage.getItem('smoothfs.tree.state.v1')).toBeNull();
  });

  it('clearPersistedState removes the entry', () => {
    savePersistedState({ selectedId: 'a', expanded: ['b'] });
    clearPersistedState();
    expect(loadPersistedState()).toBeNull();
  });

  it('survives malformed JSON without throwing', () => {
    localStorage.setItem('smoothfs.tree.state.v1', '{not-json');
    expect(loadPersistedState()).toBeNull();
  });
});
