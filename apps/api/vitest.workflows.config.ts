import { workflow } from '@workflow/vitest';
import { defineConfig } from 'vitest/config';

// Runs whole workflows in-process against a fresh local world (no server).
// Its own data dir: the default (.workflow-data) is the dev server's, and test
// setup clears it, which would wipe live local runs.
export default defineConfig({
  plugins: [workflow({ dataDir: '.workflow-vitest/data' })],
  test: {
    include: ['test/**/*.workflow.test.ts'],
    setupFiles: ['test/workflow-setup.ts'],
    testTimeout: 60_000,
  },
});
