// Shared Sentry privacy settings for every app.
//
// Sentry stores data outside India, so error events must never carry health
// data or personal details. Every collection category is switched off, and
// beforeSend strips request/user context as a second line of defence. Session
// Replay and screenshots are never enabled (they would capture health
// screens). See docs/progress.md: needs legal review before production.

/** Sentry `dataCollection` option (SDK ≥ 10.57) with everything off. */
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [] as never[],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

/** beforeSend: keep only the request method and path (no query), drop user/extra. Works with every SDK's event type. */
export function scrubSentryEvent<T extends object>(event: T): T {
  const e = event as { user?: unknown; extra?: unknown; request?: { url?: string; method?: string }; contexts?: Record<string, unknown> };
  delete e.user;
  delete e.extra;
  if (e.request) e.request = { method: e.request.method, url: e.request.url?.split('?')[0] };
  if (e.contexts) {
    delete e.contexts.state;
    delete e.contexts.profile;
  }
  return event;
}

export const sentryTracesSampleRate = 0.1;
