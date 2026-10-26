import { OpenAPIHono } from '@hono/zod-openapi';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { ErrorBody } from '@repo/contracts';
import { systemRoutes } from './modules/system/routes';

export type AppEnv = { Variables: { requestId: string } };

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const body: ErrorBody = { error: { code: 'invalid_request', message: result.error.issues.map((i) => i.message).join('; '), requestId: c.get('requestId') } };
        return c.json(body, 400);
      }
    },
  });

  app.use('*', requestId());
  app.use('*', secureHeaders());

  // Route modules, one per domain (see docs/brief.md › Architecture rules).
  // Each later phase adds its module here: auth, households, health-records,
  // consults, calls, pharmacy, labs, companion, sos, dispatch, tracking,
  // partners, payments, notifications, analytics, audit.
  app.route('/v1', systemRoutes);

  app.notFound((c) => c.json<ErrorBody>({ error: { code: 'not_found', message: 'Not found', requestId: c.get('requestId') } }, 404));

  // Never echo internals (or health data) back to the client or into logs.
  app.onError((err, c) => {
    console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), name: err.name, path: c.req.path }));
    return c.json<ErrorBody>({ error: { code: 'internal', message: 'Something went wrong', requestId: c.get('requestId') } }, 500);
  });

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    // Neutral title and no servers: clients pass their own baseUrl, and the
    // committed spec must not carry the brand name.
    info: { title: 'Platform API', version: '0.0.0' },
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
