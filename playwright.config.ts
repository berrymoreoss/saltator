import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests (`pnpm e2e`) against a production build served by `vite preview`. Kept out
 * of `pnpm check`, which must run without a browser; CI runs them as a separate step.
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Call vite directly: `pnpm exec` moves the server out of the process group Playwright kills.
    command: `node_modules/.bin/vite build --logLevel warn && node_modules/.bin/vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
