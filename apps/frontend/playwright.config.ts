import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright baseline config for SmoothFS.
 *
 * Two modes are supported:
 *   1. Dev loop (default): `bun run e2e` assumes backend + frontend are already
 *      running (see `scripts/e2e-prep.md`). This keeps E2E cycles fast and
 *      avoids coupling Playwright to the backend seed/DB lifecycle.
 *   2. CI / full stack: set `E2E_WEB_SERVER=1` to let Playwright start the Vite
 *      dev server itself. CI is expected to boot the backend + seed DB out-of-band
 *      (e.g. via docker-compose or a separate step) since the backend has its
 *      own Bun runtime + Drizzle lifecycle that Playwright doesn't own.
 *
 * The `baseURL` must match where Vite serves the SPA locally (`5173` by default).
 * The backend is consumed via `VITE_API_BASE_URL` by the app at build time, so
 * Playwright only needs the frontend URL.
 */
const PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5173);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_WEB_SERVER
    ? {
        command: 'bun run dev',
        port: PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      }
    : undefined,
});
