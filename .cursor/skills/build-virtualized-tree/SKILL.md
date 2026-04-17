---
name: build-virtualized-tree
description: Builds or extends SmoothFS's from-scratch recursive Vue folder tree so it stays smooth at millions of nodes — combining a recursive `<FolderNode />` component, lazy child loading, keyset pagination, and `vue-virtual-scroller` virtualization. Use when creating the initial tree component, adding features like expand/collapse, keyboard navigation, drag-and-drop, selection, or when the user reports jank, slow expansion, or high memory in the folder tree.
---

# Build the Custom Virtualized Folder Tree

The tree is the project's hero feature and the biggest risk for jank. Follow this recipe; don't improvise on the core structure.

## Non-negotiables (from `project-core` / `frontend-vue`)

- No pre-built tree library. Ever.
- Recursive Vue component calling itself.
- Lazy-load children on expand.
- Virtualize any list that can exceed ~200 visible rows.
- Live under `apps/frontend/src/tree/` as a standalone module (stable public API).

## Module shape

```
apps/frontend/src/tree/
  FolderTree.vue        # public entry; owns virtualization
  FolderNode.vue        # recursive; one row + children slot
  useTreeStore.ts       # Pinia store: nodes, children map, expansion map
  useTreeKeyboard.ts    # arrow keys, Home/End, Enter
  types.ts              # re-exports from @smoothfs/shared
  index.ts              # public exports only
```

## Data model (in the store)

Store nodes in flat maps, not nested objects — nested reactivity gets expensive at scale.

```ts
// all loaded nodes by id
nodes: Map<string, FolderNode>
// children ids per parent (ordered); absent = not loaded yet
childrenByParent: Map<string, string[]>
// expanded set for O(1) toggle checks
expanded: Set<string>
// pagination cursors per parent
cursorsByParent: Map<string, string | null>
```

Expose a **flattened visible list** as a computed (`visibleRows`) that walks expanded nodes in order. This is what the virtual scroller consumes.

## Lazy loading

- On `expand(id)`: if `childrenByParent.has(id)` → just toggle. Otherwise fetch first page, store, then toggle.
- On scroll near the end of a parent's loaded children: fetch next page via the stored cursor.
- Cancel in-flight fetches on collapse (AbortController).

## Virtualization

- Use `vue-virtual-scroller`'s `RecycleScroller` at the `FolderTree.vue` level over `visibleRows`.
- Fixed row height when possible — dynamic heights kill smoothness. Use a single row height (e.g. 28px) and indent via `padding-left: depth * 16px`.
- Keep `FolderNode` cheap: no heavy computeds, no inline object props, stable event handlers.

## Recursion done right

`FolderNode` renders one row + calls itself for children *only when expanded and loaded*. Inside the virtualized list, recursion is flattened — the recursive component is used for non-virtualized shallow regions only. When in doubt, flatten: the visible list is always 1-D.

## Keyboard + a11y

- `role="tree"` on the container, `role="treeitem"` per row, `aria-expanded`, `aria-level`, `aria-setsize`, `aria-posinset`.
- Arrow Right expands or moves to first child; Arrow Left collapses or moves to parent; Up/Down move focus within `visibleRows`.

## Smoothness checklist

- [ ] `visibleRows` updates in O(Δ), not O(total) (mutate incrementally)
- [ ] No `JSON.parse(JSON.stringify(...))` anywhere
- [ ] No deep watchers over `nodes` or `childrenByParent`
- [ ] Row height is constant (or buckets)
- [ ] Scroll doesn't trigger fetches on every frame — debounce end-of-list detection
- [ ] Expanding a node with 10k children doesn't freeze — only first page is rendered
- [ ] Works when cold-started with a tree of 1M total nodes (only a slice is ever in memory)

## Debuggability hooks

- Log `expand`, `fetch`, `collapse` through the shared logger with `nodeId` and `durationMs`.
- Expose `window.__tree` in dev builds for inspection (store snapshot, visible range).
- Add a dev-only perf overlay showing visible rows count and last fetch time.
