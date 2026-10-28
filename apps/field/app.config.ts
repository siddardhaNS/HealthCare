import type { ConfigContext, ExpoConfig } from 'expo/config';
import brand from '@repo/brand/brand.json';
import appIds from '@repo/config/app-ids';
import theme from './assets/generated/theme.json';

// Display name comes from @repo/brand and can change any time. The
// applicationId / bundleIdentifier are permanent after the first store
// upload and are company-based, never brand-based (see packages/config/app-ids.json).
const ids = appIds.field;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `${brand.shortName} Field`,
  slug: 'field',
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
    // VIBRATE: the incoming-job ring. RECEIVE_BOOT_COMPLETED: expo-task-manager
    // persists a job for each background location update and Android refuses
    // persisted jobs without it (the app crashed on the first job fix).
    permissions: ['VIBRATE', 'RECEIVE_BOOT_COMPLETED'],
    adaptiveIcon: {
      foregroundImage: './assets/generated/adaptive-icon.png',
      backgroundColor: theme.dark.accent,
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: brand.domains.links, pathPrefix: '/f' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-font',
    // Location streams only during an active job, through a foreground
    // service with a visible notification, so Android needs only the
    // while-in-use permission (never "Allow all the time").
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Your location is shared with the dispatch desk while you are on duty, so the nearest emergency jobs reach you and patients can see you arrive.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    // Uploads source maps during EAS builds when SENTRY_AUTH_TOKEN is set.
    ['@sentry/react-native/expo', { url: 'https://sentry.io/', organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }],
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
