import { OpenAPIHono } from '@hono/zod-openapi';
import { requestId } from 'hono/request-id';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { ErrorBody } from '@repo/contracts';
import { ConfigError, depsFromEnv, type Deps } from './deps';
import type { AccessClaims } from './middleware/auth';
import { authHookRoutes, authRoutes } from './modules/auth/routes';
import { consentRoutes } from './modules/consent/routes';
import { healthRoutes } from './modules/health/routes';
import { householdRoutes } from './modules/households/routes';
import { residentRoutes } from './modules/residents/routes';
import { sosRoutes } from './modules/sos/routes';
import { leadsRoutes } from './modules/leads/routes';
import { whatsappWebhookRoutes } from './modules/messaging/routes';
import { systemRoutes } from './modules/system/routes';

export type AppEnv = { Variables: { requestId: string; deps: Deps; auth?: AccessClaims } };

export interface CreateAppOptions {
  /** Injected in tests; built from the environment on first use otherwise. */
  deps?: () => Deps;
  /** Registers middleware ahead of everything else (Sentry in production). */
  before?: (app: OpenAPIHono<AppEnv>) => void;
  /** Browser origins allowed to call public endpoints (the landing site). */
  webOrigins?: string[];
}

export function createApp(options: CreateAppOptions = {}) {
  let deps: Deps | undefined;
  const getDeps = options.deps ?? (() => (deps ??= depsFromEnv()));

  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const body: ErrorBody = { error: { code: 'invalid_request', message: result.error.issues.map((i) => i.message).join('; '), requestId: c.get('requestId') } };
        return c.json(body, 400);
      }
    },
  });

  options.before?.(app);
  app.use('*', requestId());
  app.use('*', secureHeaders());

  // Route modules, one per domain (see the brief › Architecture rules).
  // Each later phase adds its module here: households, health-records,
  // consults, calls, pharmacy, labs, companion, sos, dispatch, tracking,
  // partners, payments, notifications, analytics, audit.
  app.route('/v1', systemRoutes);

  // Routes that need configuration. /v1/health and /openapi.json do not, so
  // they work (and the spec can be generated) without any secrets.
  const withDeps = async (c: { set: (k: 'deps', v: Deps) => void }, next: () => Promise<void>) => {
    c.set('deps', getDeps());
    await next();
  };
  // The landing site posts sign-ups straight from the browser.
  const webOrigins = options.webOrigins ?? (process.env.WEB_ORIGINS ?? 'http://localhost:3000,http://localhost:3003').split(',').map((o) => o.trim());
  app.use('/v1/leads', cors({ origin: webOrigins, allowMethods: ['POST'], allowHeaders: ['content-type'], maxAge: 600 }));

  for (const path of ['/v1/auth/*', '/v1/me', '/v1/leads', '/v1/leads/*', '/v1/consents', '/v1/consents/*', '/v1/households', '/v1/households/*', '/v1/me/*', '/v1/people/*', '/v1/residents', '/v1/residents/*', '/v1/sos', '/v1/sos/*', '/webhooks/*']) app.use(path, withDeps);
  app.route('/v1', authRoutes);
  app.route('/v1', authHookRoutes);
  app.route('/v1', leadsRoutes);
  app.route('/v1', consentRoutes);
  app.route('/v1', householdRoutes);
  app.route('/v1', residentRoutes);
  app.route('/v1', healthRoutes);
  app.route('/v1', sosRoutes);
  app.route('/', whatsappWebhookRoutes);

  app.notFound((c) => c.json<ErrorBody>({ error: { code: 'not_found', message: 'Not found', requestId: c.get('requestId') } }, 404));

  // Never echo internals (or health data) back to the client or into logs.
  app.onError((err, c) => {
    // Config errors name the variables (never values) so operators can fix them.
    const detail = err instanceof ConfigError ? { message: err.message } : {};
    console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), name: err.name, path: c.req.path, ...detail }));
    return c.json<ErrorBody>({ error: { code: 'internal', message: 'Something went wrong', requestId: c.get('requestId') } }, 500);
  });

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    // Neutral title and no servers: clients pass their own baseUrl, and the
    // committed spec must not carry the brand name.
    info: { title: 'Platform API', version: '0.0.0' },
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
