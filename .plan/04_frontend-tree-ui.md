# Phase 04 — Frontend Tree UI and Interaction Model

## Objective

Build a custom, maintainable tree UI (from scratch) that handles deep and large folder structures with smooth interaction.

## Project-core alignment

- **Smooth:** virtualization, lazy loading, and stable reactivity prevent DOM/render bottlenecks.
- **Reliable:** strict typed state flows through Pinia and shared DTOs.
- **Debuggable:** unified API client error normalization and operation-scoped debug metadata.

## Tasks

- Scaffold frontend app with Vue 3 Composition API and Pinia.
- Create custom tree module under `apps/frontend/src/tree/`:
  - `FolderTree` container
  - recursive `FolderNode` component
  - tree store/composables
- Implement left panel behavior:
  - expand/collapse state
  - lazy load children on expansion
  - preserve expansion state across refresh/navigation (if selected design requires it)
- Implement right panel behavior:
  - load direct subfolders/files for selected node
  - show empty/loading/error states
- Add virtualization (`vue-virtual-scroller`) where visible rows can grow large.
- Add keyboard and accessibility baseline:
  - roles for tree/treeitem
  - `aria-expanded`
  - focus management for arrow navigation
- Add centralized frontend API client:
  - timeout handling
  - normalized error mapping
  - request ID forwarding
- Style with Tailwind + permitted UI primitives only.

## Done criteria

- Tree is custom-built (no forbidden library usage).
- Expanding deep nodes remains responsive on large mock datasets.
- Right panel always reflects selected node deterministically.
- Error/loading states are visible and actionable.

## Vague edge cases (needs choice)

- **Virtualization model:** flatten visible tree rows globally vs virtualize per-level lists.
- **State persistence depth:** persist only selected node vs selected + expanded path.
- **Prefetch policy:** fetch children only on click vs prefetch siblings/next page opportunistically.
- **Selection semantics:** selecting a folder auto-expands it vs selection and expansion remain independent.

User's Choice:
- Flatten visible tree rows globally (1D array - avoid DOM nightmare)
- Persist selected node + its expanded path
- Fetch children only on click
- Selection and expansion strictly independent (try to follow Windows Explorer UX behaviours)