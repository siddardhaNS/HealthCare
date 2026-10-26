import type { ConfigContext, ExpoConfig } from 'expo/config';
import brand from '@repo/brand/brand.json';
import appIds from '@repo/config/app-ids';
import theme from './assets/generated/theme.json';

// Display name comes from @repo/brand and can change any time. The
// applicationId / bundleIdentifier are permanent after the first store
// upload and are company-based, never brand-based (see packages/config/app-ids.json).
const ids = appIds.resident;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: brand.shortName,
  slug: 'resident',
  scheme: ids.scheme,
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/generated/icon.png',
  ios: {
    bundleIdentifier: ids.bundleIdentifier,
    supportsTablet: false,
    associatedDomains: [`applinks:${brand.domains.links}`],
  },
  android: {
    package: ids.applicationId,
    adaptiveIcon: {
      foregroundImage: './assets/generated/adaptive-icon.png',
      backgroundColor: theme.dark.bg,
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: brand.domains.links, pathPrefix: '/r' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/generated/splash.png',
        imageWidth: 160,
        backgroundColor: theme.light.bg,
        dark: { image: './assets/generated/splash.png', backgroundColor: theme.dark.bg },
      },
    ],
  ],
  experiments: { typedRoutes: true },
});
