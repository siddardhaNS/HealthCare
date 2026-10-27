// Every request goes to the Hono app. Workflow's own routes
// (/.well-known/workflow/…) are more specific and win over this catch-all.
import '../../src/instrument';
import { sentry } from '@sentry/hono/node';
import { handle } from 'hono/vercel';
import { createApp } from '../../src/app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = handle(createApp({ before: process.env.SENTRY_DSN ? (a) => a.use('*', sentry(a)) : undefined }));

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
