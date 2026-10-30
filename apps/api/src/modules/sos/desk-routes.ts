import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  DeskClose,
  DeskIncidentDetail,
  DeskIncidentList,
  DeskOfferCreate,
  DeskReason,
  DeskReassign,
  DeskSites,
  ErrorBody,
  Fleet,
  TestSosCreate,
  type ErrorBody as ErrorBodyT,
} from '@repo/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth, requireStaff } from '../../middleware/auth';
import type { DeskIncidentRow } from './desk-repo';
import { deskCancel, deskClose, deskDetail, deskHandOver, deskOffer, deskReadRoles, deskReassign, deskView, loadForStaff, staffOf, testSos, type DeskDeps, type Staff } from './desk';
import { isSosFailure, type SosFailure } from './transition';
import type { IncidentRow } from './repo';

const security = [{ bearer: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const failures = { 400: json(ErrorBody, 'Invalid'), 401: json(ErrorBody, 'Not signed in'), 403: json(ErrorBody, 'Not allowed'), 404: json(ErrorBody, 'Not found'), 409: json(ErrorBody, 'Not possible in the current state') };
const staffOnly = { security, middleware: [requireAuth, requireStaff(deskReadRoles)] };
const statusOf: Record<SosFailure['error'], 400 | 403 | 404 | 409> = { not_found: 404, forbidden: 403, illegal_transition: 409, not_your_move: 403, reason_required: 400, conflict: 409 };
const failure = (c: Context<AppEnv>, f: SosFailure) => c.json({ error: { code: f.error, message: f.message, requestId: c.get('requestId') } } satisfies ErrorBodyT, statusOf[f.error]);
const idParam = { params: z.object({ id: z.string().uuid() }) };

const deps = (c: Context<AppEnv>): DeskDeps => c.get('deps');
const staff = (c: Context<AppEnv>): Promise<Staff> => staffOf(c.get('auth')!, () => c.get('deps').residents.deskSites(c.get('auth')!.userId));

const action = <T extends z.ZodType>(path: string, operationId: string, summary: string, schema: T) =>
  createRoute({ method: 'post', path: `/desk/sos/{id}/${path}`, operationId, tags: ['desk'], summary, ...staffOnly, request: { ...idParam, ...body(schema) }, responses: { 200: json(DeskIncidentDetail, 'Updated'), ...failures } });

const r = {
  list: createRoute({
    method: 'get',
    path: '/desk/sos',
    operationId: 'deskIncidents',
    tags: ['desk'],
    summary: 'Command center: open incidents, or those closed in the last day (community desk: its own community only)',
    ...staffOnly,
    request: { query: z.object({ view: z.enum(['open', 'recent']).default('open') }) },
    responses: { 200: json(DeskIncidentList, 'Incidents'), ...failures },
  }),
  get: createRoute({ method: 'get', path: '/desk/sos/{id}', operationId: 'deskIncident', tags: ['desk'], summary: 'An incident with its timeline, offers and the crew on the job', ...staffOnly, request: idParam, responses: { 200: json(DeskIncidentDetail, 'Incident'), ...failures } }),
  cancel: action('cancel', 'deskCancelSos', 'Cancel with a reason (false alarm, resident safe)', DeskReason),
  reassign: action('reassign', 'deskReassignSos', 'Take the job back from its crew and dispatch again (optionally offering a chosen crew at once)', DeskReassign),
  offer: action('offers', 'deskOfferSos', 'Manual dispatch: offer the job to a chosen free crew', DeskOfferCreate),
  handOver: action('hand-over', 'deskHandOverSos', 'Mark handed over at the hospital when the crew cannot', DeskReason),
  close: action('close', 'deskCloseSos', 'Close (after hand-over; otherwise with a reason)', DeskClose),
  test: createRoute({
    method: 'post',
    path: '/desk/sos/test',
    operationId: 'deskTestSos',
    tags: ['desk'],
    summary: 'Run a test SOS (drill) for a community: drill crews only, labelled DRILL, no messages to families or hospitals',
    ...staffOnly,
    request: body(TestSosCreate),
    responses: { 201: json(DeskIncidentDetail, 'Drill raised'), 200: json(DeskIncidentDetail, 'Your drill already open'), ...failures },
  }),
  fleet: createRoute({ method: 'get', path: '/desk/fleet', operationId: 'deskFleet', tags: ['desk'], summary: 'Ambulance crews: duty, vehicle, current job and last position', ...staffOnly, responses: { 200: json(Fleet, 'Fleet'), ...failures } }),
  sites: createRoute({ method: 'get', path: '/desk/sites', operationId: 'deskSites', tags: ['desk'], summary: 'Communities this staff member covers (for test SOS)', ...staffOnly, responses: { 200: json(DeskSites, 'Communities'), ...failures } }),
};

/** Loads the incident in scope, applies `change`, and answers with the fresh detail. */
async function act(c: Context<AppEnv>, id: string, change: (s: Staff, row: DeskIncidentRow) => Promise<IncidentRow | SosFailure>) {
  const s = await staff(c);
  const row = await loadForStaff(deps(c), s, id);
  if (isSosFailure(row)) return failure(c, row);
  const done = await change(s, row);
  if (isSosFailure(done)) return failure(c, done);
  return c.json(await deskDetail(deps(c), (await deps(c).desk.incident(id))!), 200);
}

export const deskRoutes = new OpenAPIHono<AppEnv>()
  .openapi(r.list, async (c) => {
    const s = await staff(c);
    const rows = await deps(c).desk.incidents({ siteIds: s.sites, open: c.req.valid('query').view === 'open', limit: 50 });
    return c.json({ incidents: await Promise.all(rows.map((row) => deskView(deps(c), row))) }, 200);
  })
  .openapi(r.fleet, async (c) => {
    const d = deps(c);
    const crews = await d.desk.fleet();
    const at = await Promise.all(crews.map((x) => (x.onDuty ? d.locator.position(x.crewId) : null)));
    return c.json({ crews: crews.map((x, n) => ({ ...x, position: at[n] ? { lat: at[n].lat, lng: at[n].lng, at: new Date(at[n].at).toISOString() } : null })) }, 200);
  })
  .openapi(r.sites, async (c) => c.json({ sites: await deps(c).desk.sites((await staff(c)).sites) }, 200))
  .openapi(r.test, async (c) => {
    const result = await testSos(deps(c), await staff(c), c.req.valid('json').siteId);
    if (isSosFailure(result)) return failure(c, result);
    const detail = await deskDetail(deps(c), (await deps(c).desk.incident(result.incident.id))!);
    return result.created ? c.json(detail, 201) : c.json(detail, 200);
  })
  .openapi(r.get, async (c) => {
    const row = await loadForStaff(deps(c), await staff(c), c.req.valid('param').id);
    if (isSosFailure(row)) return failure(c, row);
    return c.json(await deskDetail(deps(c), row), 200);
  })
  .openapi(r.cancel, (c) => act(c, c.req.valid('param').id, (s, row) => deskCancel(deps(c), s, row, c.req.valid('json').reason)))
  .openapi(r.reassign, (c) => {
    const { reason, crewId } = c.req.valid('json');
    return act(c, c.req.valid('param').id, (s, row) => deskReassign(deps(c), s, row, reason, crewId));
  })
  .openapi(r.offer, (c) => act(c, c.req.valid('param').id, (s, row) => deskOffer(deps(c), s, row, c.req.valid('json').crewId)))
  .openapi(r.handOver, (c) => act(c, c.req.valid('param').id, (s, row) => deskHandOver(deps(c), s, row, c.req.valid('json').reason)))
  .openapi(r.close, (c) => act(c, c.req.valid('param').id, (s, row) => deskClose(deps(c), s, row, c.req.valid('json').reason ?? null)));
