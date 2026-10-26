import type { NextConfig } from 'next';

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@repo/api-client', '@repo/brand', '@repo/i18n', '@repo/tokens', '@repo/ui-web'],
  poweredByHeader: false,
};

export default config;
