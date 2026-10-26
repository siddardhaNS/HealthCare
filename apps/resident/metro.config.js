// Metro with Sentry debug IDs for source maps. Otherwise Expo's defaults
// (monorepo resolution is automatic since SDK 52).
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
