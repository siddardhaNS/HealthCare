import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@repo/api-client', '@repo/brand', '@repo/config', '@repo/contracts', '@repo/i18n', '@repo/tokens', '@repo/ui-web'],
  poweredByHeader: false,
};

// Source maps upload only when SENTRY_AUTH_TOKEN is set (CI / Vercel).
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
