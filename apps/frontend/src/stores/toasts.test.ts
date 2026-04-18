import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useToastStore } from './toasts';

describe('toast store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('show() enqueues a toast with default plain duration', () => {
    const toasts = useToastStore();
    const id = toasts.show({ message: 'Hello' });
    expect(toasts.items).toHaveLength(1);
    const t = toasts.items[0]!;
    expect(t.id).toBe(id);
    expect(t.message).toBe('Hello');
    expect(t.variant).toBe('info');
    expect(t.action).toBeNull();
    expect(t.actionPending).toBe(false);
    expect(t.durationMs).toBe(4000);
  });

  it('action-bearing toasts default to a longer duration', () => {
    const toasts = useToastStore();
    toasts.show({
      message: 'Deleted X',
      action: { label: 'Undo', onActivate: () => {} },
    });
    expect(toasts.items[0]!.durationMs).toBe(7000);
  });

  it('autoclose dismisses after the configured duration', () => {
    const toasts = useToastStore();
    toasts.show({ message: 'Hi', durationMs: 1000 });
    expect(toasts.items).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(toasts.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.items).toHaveLength(0);
  });

  it('durationMs=0 is sticky (no autoclose)', () => {
    const toasts = useToastStore();
    toasts.show({ message: 'Sticky', durationMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(toasts.items).toHaveLength(1);
  });

  it('pause() preserves remaining time and resume() honors it', () => {
    const toasts = useToastStore();
    const id = toasts.show({ message: 'X', durationMs: 1000 });

    vi.advanceTimersByTime(400);
    toasts.pause(id);
    // While paused, time advancing should not dismiss.
    vi.advanceTimersByTime(10_000);
    expect(toasts.items).toHaveLength(1);

    toasts.resume(id);
    vi.advanceTimersByTime(599);
    expect(toasts.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.items).toHaveLength(0);
  });

  it('activate() sets pending while the action is in flight, then dismisses', async () => {
    const toasts = useToastStore();
    let resolveAction!: () => void;
    const work = new Promise<void>((r) => { resolveAction = r; });
    const id = toasts.show({
      message: 'Deleted',
      action: { label: 'Undo', onActivate: () => work },
    });

    const activated = toasts.activate(id);
    // Allow the microtask that starts onActivate + flips actionPending to run.
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.items[0]!.actionPending).toBe(true);

    resolveAction();
    await activated;
    expect(toasts.items).toHaveLength(0);
  });

  it('activate() replaces the toast with an error variant on failure', async () => {
    const toasts = useToastStore();
    toasts.show({
      message: 'Deleted',
      action: {
        label: 'Undo',
        onActivate: () => Promise.reject(new Error('boom')),
      },
    });
    const id = toasts.items[0]!.id;
    await toasts.activate(id);

    expect(toasts.items).toHaveLength(1);
    const t = toasts.items[0]!;
    expect(t.variant).toBe('error');
    expect(t.message).toContain('boom');
    // The error replacement is a brand-new toast (different id).
    expect(t.id).not.toBe(id);
  });

  it('activate() is a no-op while another activation for the same id is pending', async () => {
    const toasts = useToastStore();
    const onActivate = vi.fn(
      () => new Promise<void>((r) => setTimeout(r, 100)),
    );
    const id = toasts.show({
      message: 'X',
      action: { label: 'Undo', onActivate },
    });

    const first = toasts.activate(id);
    await vi.advanceTimersByTimeAsync(0);
    // Second click while pending should not re-invoke the handler.
    void toasts.activate(id);
    void toasts.activate(id);

    await vi.advanceTimersByTimeAsync(200);
    await first;
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('dismiss() removes a single toast and clears its timer', () => {
    const toasts = useToastStore();
    const a = toasts.show({ message: 'A' });
    const b = toasts.show({ message: 'B' });
    toasts.dismiss(a);
    expect(toasts.items.map((t) => t.id)).toEqual([b]);
  });

  it('dismissAll() clears the queue', () => {
    const toasts = useToastStore();
    toasts.show({ message: 'A' });
    toasts.show({ message: 'B' });
    toasts.dismissAll();
    expect(toasts.items).toHaveLength(0);
  });
});
