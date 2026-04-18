# SmoothFS end-to-end smoke tests

These Playwright specs exercise the running stack end-to-end. They are
intentionally minimal; unit tests in `src/**/*.test.ts` cover behavior at
component/store level.

## Prerequisites (one-time)

```bash
bun install
cd apps/frontend && bunx playwright install chromium
```

## Running locally

The default E2E config assumes you already have the backend and the frontend
running, so the test loop stays fast:

```bash
# Terminal 1 — backend
cd apps/backend
NODE_ENV=development bun run dev

# Terminal 2 — frontend
cd apps/frontend
bun run dev

# Terminal 3 — E2E
cd apps/frontend
bun run e2e
```

The backend should be reachable at `http://localhost:3000` and have at least a
minimal seeded tree (`apps/backend/scripts/seed.ts`).

If you prefer Playwright to manage the Vite dev server for you, set
`E2E_WEB_SERVER=1`:

```bash
E2E_WEB_SERVER=1 bun run e2e
```

## What is covered

- `tree.smoke.spec.ts`
  - App shell loads and the folder tree is visible.
  - Clicking a root navigates and populates the content panel.
  - Roving tabindex contract holds (exactly one tabbable treeitem).
  - Double-clicking a file opens the preview placeholder dialog (skipped
    automatically when the seeded tree has no files in the first few roots).
