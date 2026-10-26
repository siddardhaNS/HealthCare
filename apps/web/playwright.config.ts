import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL points at a running server (local dev or a Vercel preview);
// otherwise Playwright builds and starts this app itself.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Low-end Android phone width.
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: 'pnpm build && pnpm start', url: baseURL, timeout: 240_000, reuseExistingServer: !process.env.CI },
});
