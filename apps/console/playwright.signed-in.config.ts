import { defineConfig, devices } from '@playwright/test';

// Signed-in journeys against the local Supabase stack (sign-in + TOTP, command
// center, hospital handover, partner portal). Needs `pnpm supabase start`, the
// repo .env, and the API on :3001; Playwright starts the console itself.
//   pnpm --filter console e2e:signed-in
// One worker: the tests share one test crew and run in order.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3002';

export default defineConfig({
  testDir: './e2e-signed-in',
  globalSetup: './e2e-signed-in/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  projects: [
    { name: 'sign-in', testMatch: /auth\.setup\.ts/ },
    { name: 'signed-in', testMatch: /\.spec\.ts/, dependencies: ['sign-in'] },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: process.env.CI ? 'pnpm build && pnpm start' : 'pnpm dev', url: baseURL, timeout: 240_000, reuseExistingServer: !process.env.CI },
});
