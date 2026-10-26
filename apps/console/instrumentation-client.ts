// Browser Sentry. No-op without NEXT_PUBLIC_SENTRY_DSN. Never enable Session
// Replay or the feedback widget: screens can show health data.
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent, sentryDataCollection, sentryTracesSampleRate } from '@repo/config/sentry';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    tracesSampleRate: sentryTracesSampleRate,
    dataCollection: sentryDataCollection,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
