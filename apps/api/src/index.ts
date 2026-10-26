// Vercel zero-config entry: the default export is the Hono app, served as
// Vercel Functions (Fluid compute) in bom1 per vercel.json.
import './instrument';
import { sentry } from '@sentry/hono/node';
import { createApp } from './app';

const app = createApp({ before: process.env.SENTRY_DSN ? (a) => a.use('*', sentry(a)) : undefined });

export default app;
