import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { ErrorBody, ResidentSos, SosCancel, SosRaise, type ErrorBody as ErrorBodyT } from '@repo/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { checkLimits } from '../../lib/rate-limit';
import { requireAuth } from '../../middleware/auth';
import { isSosFailure, loadForPerson, move, raise, residentView, startEscalation, type SosFailure } from './service';

const security = [{ bearer: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const failures = { 400: json(ErrorBody, 'Invalid'), 401: json(ErrorBody, 'Not signed in'), 403: json(ErrorBody, 'Not allowed'), 404: json(ErrorBody, 'Not found'), 409: json(ErrorBody, 'Not possible in the current state'), 429: json(ErrorBody, 'Too many requests') };
const authed = { security, middleware: [requireAuth] };
const statusOf: Record<SosFailure['error'], 400 | 403 | 404 | 409> = { not_found: 404, forbidden: 403, illegal_transition: 409, not_your_move: 403, reason_required: 400, conflict: 409 };
const failure = (c: Context<AppEnv>, f: SosFailure) => c.json({ error: { code: f.error, message: f.message, requestId: c.get('requestId') } } satisfies ErrorBodyT, statusOf[f.error]);

const r = {
  raise: createRoute({
    method: 'post',
    path: '/sos',
    operationId: 'raiseSos',
    tags: ['sos'],
    summary: 'Raise an SOS. Idempotent: retries and second presses return the same open incident (200); a new one is 201.',
    ...authed,
    request: { body: { content: { 'application/json': { schema: SosRaise } }, required: true } },
    responses: { 201: json(ResidentSos, 'Raised'), 200: json(ResidentSos, 'Already open'), ...failures },
  }),
  current: createRoute({ method: 'get', path: '/sos/current', operationId: 'currentSos', tags: ['sos'], summary: 'My open SOS, if any (the app checks this on launch)', ...authed, responses: { 200: json(ResidentSos.nullable(), 'Open incident or null'), ...failures } }),
  get: createRoute({ method: 'get', path: '/sos/{id}', operationId: 'getSos', tags: ['sos'], summary: 'An SOS with its full timeline and the ambulance on its way (the person or their manager)', ...authed, request: { params: z.object({ id: z.string().uuid() }) }, responses: { 200: json(ResidentSos, 'Incident'), ...failures } }),
  cancel: createRoute({
    method: 'post',
    path: '/sos/{id}/cancel',
    operationId: 'cancelSos',
    tags: ['sos'],
    summary: 'Cancel an SOS (allowed until a crew is on the way; after that the desk cancels)',
    ...authed,
    request: { params: z.object({ id: z.string().uuid() }), body: { content: { 'application/json': { schema: SosCancel } }, required: true } },
    responses: { 200: json(ResidentSos, 'Cancelled'), ...failures },
  }),
};

export const sosRoutes = new OpenAPIHono<AppEnv>()
  .openapi(r.raise, async (c) => {
    const me = c.get('auth')!.userId;
    const deps = c.get('deps');
    // Generous: an SOS must never be refused for being pressed again; this only stops abuse.
    const limited = await checkLimits(deps.kv, `sos:${me}`, [{ limit: 20, windowSeconds: 3600 }]);
    if (!limited.ok) {
      c.header('retry-after', String(limited.retryAfterSeconds));
      return c.json({ error: { code: 'rate_limited', message: 'Too many SOS requests. Call 108 if you need help now.', requestId: c.get('requestId') } } satisfies ErrorBodyT, 429);
    }
    const { incident, created } = await raise({ sos: deps.sos, households: deps.households }, { id: me, role: 'resident' }, me, c.req.valid('json'));
    if (created) await startEscalation(deps, incident.id, c.get('requestId'));    const view = await residentView(deps, incident);
    return created ? c.json(view, 201) : c.json(view, 200);
  })
  .openapi(r.current, async (c) => {
    const deps = c.get('deps');
    const open = await deps.sos.openForUser(c.get('auth')!.userId);
    return c.json(open ? await residentView(deps, open) : null, 200);
  })
  .openapi(r.get, async (c) => {
    const deps = c.get('deps');
    const i = await loadForPerson({ sos: deps.sos, households: deps.households }, c.get('auth')!.userId, c.req.valid('param').id);
    if (isSosFailure(i)) return failure(c, i);
    return c.json(await residentView(deps, i), 200);
  })
  .openapi(r.cancel, async (c) => {
    const deps = c.get('deps');
    const me = c.get('auth')!.userId;
    const i = await loadForPerson({ sos: deps.sos, households: deps.households }, me, c.req.valid('param').id);
    if (isSosFailure(i)) return failure(c, i);
    const next = await move(deps.sos, i, 'cancelled', { id: me, role: 'resident' }, c.req.valid('json').reason ?? null);
    if (isSosFailure(next)) return failure(c, next);
    await deps.escalation.signal(next.id, { kind: 'settled', state: next.state });
    return c.json(await residentView(deps, next), 200);
  });
