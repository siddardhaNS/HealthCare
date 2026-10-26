// Loaded before the app (see index.ts / dev.ts). No-op without SENTRY_DSN.
import * as Sentry from '@sentry/hono/node';
import { scrubSentryEvent, sentryDataCollection, sentryTracesSampleRate } from '@repo/config/sentry';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? 'development',
    tracesSampleRate: sentryTracesSampleRate,
    dataCollection: sentryDataCollection,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
