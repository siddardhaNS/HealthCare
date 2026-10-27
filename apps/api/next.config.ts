import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

// Next.js only hosts the Hono app (app/[[...path]]/route.ts) so Vercel
// Workflows can use their stable Next.js integration. Plan: docs/plans/phase-3-sos.md ⚑1.

// Local dev reads the repo-root .env, like the scripts do. Vercel sets env vars itself.
try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env file: rely on the environment.
}

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@repo/brand', '@repo/config', '@repo/contracts', '@repo/db'],
  poweredByHeader: false,
};

export default withWorkflow(config);
