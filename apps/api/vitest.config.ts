import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Whole-workflow runs need the Workflow compiler: vitest.workflows.config.ts.
    exclude: ['test/**/*.workflow.test.ts'],
  },
});
