// Local development server. In production Vercel serves src/index.ts.
import './instrument';
import { serve } from '@hono/node-server';
import { sentry } from '@sentry/hono/node';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: createApp({ before: process.env.SENTRY_DSN ? (a) => a.use('*', sentry(a)) : undefined }).fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
