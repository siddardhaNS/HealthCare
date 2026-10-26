import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent, sentryDataCollection, sentryTracesSampleRate } from '@repo/config/sentry';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? 'development',
    tracesSampleRate: sentryTracesSampleRate,
    dataCollection: sentryDataCollection,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}
