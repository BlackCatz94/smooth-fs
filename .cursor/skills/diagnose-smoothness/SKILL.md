---
name: diagnose-smoothness
description: Methodical workflow for diagnosing and fixing slowness, jank, or memory issues in SmoothFS — isolates whether the bottleneck is SQL, API, network, store, Vue reactivity, or rendering, then applies the right fix. Use when the user reports lag, dropped frames, slow folder expansion, long initial load, high memory usage, or when a page feels "heavy" or "janky".
---

# Diagnose Smoothness Issues

Don't guess. Measure, then fix the single biggest cost.

## Step 0 — Reproduce and quantify

Before changing code, capture a baseline:

- What action is slow? (initial load, expand, search, scroll)
- What dataset size? (nodes/level, total nodes)
- Numbers, not feelings: frame rate, time-to-interactive, API latency, SQL time.

If you can't reproduce, ask the user for the dataset + steps before touching code.

## Step 1 — Locate the layer

Work outside-in. Stop at the first layer that clearly dominates.

1. **Network tab** — is one request >100ms? Is the payload huge? Are there dozens of parallel requests (N+1)?
2. **Server logs** — read request duration per endpoint. Any outlier?
3. **SQL** — run the slow endpoint's query with `EXPLAIN (ANALYZE, BUFFERS)`. Look for `Seq Scan` on hot tables, missing index usage, or unbounded recursion.
4. **Frontend Performance profile** — record during the slow action. Look for long tasks >50ms, forced reflows, excessive component updates.
5. **Memory tab** — retained size growing per expand/collapse cycle? That's a leak (usually forgotten listeners or unreleased children cache).

## Step 2 — Apply the matching fix

### If SQL is slow
- Missing index → add (see `tree-data-model` for standard ones) and re-run `EXPLAIN`.
- Recursive CTE with no depth cap → add `WHERE depth < $n`.
- `OFFSET` pagination on deep pages → switch to keyset cursor.
- Over-fetching columns → `SELECT` only what the repo contract needs.

### If API is slow but SQL is fast
- Serialization cost → reduce payload shape, drop unused fields.
- Missing cache → add short-TTL in-memory cache for hot reads (initial tree root).
- Blocking middleware → move heavy work off the request path.

### If network is the problem
- N+1 requests from the client → batch via one endpoint, or load lazily per expand only.
- No HTTP caching → set `ETag` / `Cache-Control` on immutable reads.

### If the Pinia store is the bottleneck
- Deep watchers over the whole tree → switch to flat maps keyed by id, subscribe per node.
- Recomputing `visibleRows` from scratch every change → mutate incrementally.
- `JSON.parse(JSON.stringify(...))` clones → remove; use structural sharing.

### If Vue rendering is the bottleneck
- Long visible list without virtualization → wrap with `RecycleScroller`.
- Variable row height → fix to a single height (use buckets if truly needed).
- Heavy work inside `<template>` → hoist to `computed` with narrow deps.
- Passing fresh objects as props each render → stabilize with `computed` or `shallowRef`.
- Keying by index → switch to node `id`.

### If memory grows unbounded
- Children cache never evicts → LRU-bound it, or clear on collapse after N minutes.
- Listeners not cleaned up in `onUnmounted` → add cleanup.
- AbortControllers not aborted on collapse/unmount → abort.

## Step 3 — Verify the fix

- Re-run the same measurement. Document before/after numbers in the PR description.
- Add a regression test if feasible (e.g. unit test asserting `visibleRows` isn't recomputed when unrelated state changes, or an integration test asserting the slow SQL now uses an index).

## Step 4 — Improve debuggability for next time

If this was hard to diagnose, leave the path better:

- Add structured log lines with timings at the layer that was opaque.
- Extend the dev perf overlay with the metric you wished you had.
- Note the pattern in the relevant rule file if it's likely to recur.

## Anti-patterns to refuse

- "Just throw a `setTimeout`/`nextTick` at it" — masks the cause.
- "Memoize everything" — adds cost; memoize the specific hot computed.
- "Switch to a tree library" — forbidden by `project-core`.
