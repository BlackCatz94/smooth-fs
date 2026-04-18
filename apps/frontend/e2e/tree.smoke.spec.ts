import { test, expect } from '@playwright/test';

/**
 * Baseline smoke flow for the Phase 5 Testing & Polish gate.
 *
 * Requirements (document in scripts/e2e-prep.md):
 *  - Backend is running on :3000 and seeded with at least one non-empty folder
 *    with nested children.
 *  - Frontend is running on :5173 and configured with VITE_API_BASE_URL matching
 *    the backend.
 *
 * The test is intentionally small and deterministic: load app, expand a root
 * folder, verify the content panel updates, verify roving focus stays within
 * the tree, and verify the file-open placeholder dialog opens when present.
 */

test.describe('SmoothFS smoke', () => {
  test('loads the folder shell without fatal errors', async ({ page }) => {
    await page.goto('/folders');
    await expect(page.getByRole('tree', { name: /folders/i })).toBeVisible();
    const treeitems = page.getByRole('treeitem');
    await expect(treeitems.first()).toBeVisible({ timeout: 10_000 });
  });

  test('expands a root folder and shows contents in the right panel', async ({ page }) => {
    await page.goto('/folders');

    const firstItem = page.getByRole('treeitem').first();
    await expect(firstItem).toBeVisible({ timeout: 10_000 });

    // Click to select — this navigates the route and loads contents.
    await firstItem.click();

    // Expand the row via keyboard (preserving the roving-focus contract).
    await firstItem.press('ArrowRight');

    // Right panel shows either folder contents or empty state, but never the
    // generic "select a folder" hint once we have selected one.
    const rightPanel = page.getByText(/select a folder to view/i);
    await expect(rightPanel).toHaveCount(0);
  });

  test('roving tabindex: exactly one treeitem is tabbable after load', async ({ page }) => {
    await page.goto('/folders');
    const firstItem = page.getByRole('treeitem').first();
    await expect(firstItem).toBeVisible({ timeout: 10_000 });

    const tabbableCount = await page.locator('[role="treeitem"][tabindex="0"]').count();
    expect(tabbableCount).toBe(1);
  });

  test('file double-click opens the placeholder preview dialog when a file exists', async ({
    page,
  }) => {
    await page.goto('/folders');
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 10_000 });

    // Strategy: click the first root, then walk each sub-folder in the right
    // panel until one contains files. The default seed fixture ("deep" linear
    // chain + "wide" fan-out) puts files only on the wide-* siblings, so we
    // have to iterate rather than assume the first child has them.
    const roots = page.locator('[role="tree"] [role="treeitem"]');
    await roots.first().click();

    // Wait until at least one content item is present in the right panel
    // before measuring. Avoid `networkidle` — Vite's HMR websocket keeps the
    // network "busy" in dev, which would time us out.
    await expect(page.locator('[data-content-item-key]').first()).toBeVisible();

    let fileTile = page.locator('[data-content-item-kind="file"]').first();
    if ((await fileTile.count()) === 0) {
      const folderCount = await page.locator('[data-content-item-kind="folder"]').count();
      for (let i = 0; i < Math.min(folderCount, 10); i += 1) {
        const candidate = page.locator('[data-content-item-kind="folder"]').nth(i);
        const folderName = (await candidate.innerText()).split('\n')[0];
        await candidate.dblclick();
        // The content panel replaces its items when navigating; wait for the
        // new set to render by polling the first item's name until it differs
        // (or until we see a file).
        await page.waitForFunction(
          (prev) => {
            const first = document.querySelector<HTMLElement>('[data-content-item-key]');
            const firstName = first?.innerText?.split('\n')[0] ?? null;
            const hasFile = document.querySelector('[data-content-item-kind="file"]') !== null;
            return hasFile || (firstName !== null && firstName !== prev);
          },
          folderName,
          { timeout: 5_000 },
        );
        fileTile = page.locator('[data-content-item-kind="file"]').first();
        if ((await fileTile.count()) > 0) break;
        await roots.first().click();
        await expect(page.locator('[data-content-item-key]').first()).toBeVisible();
      }
    }

    if ((await fileTile.count()) === 0) {
      test.skip(true, 'seed data contains no files within the sampled folders');
      return;
    }

    await fileTile.dblclick();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/preview is not available yet/i);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});
