import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  ErrorBody,
  FirstAidNotes,
  HandoverLinkView,
  HandoverRedirect,
  NearbyHospital,
  HandoverSummary,
  Hospital,
  HospitalCapacity,
  HospitalChoices,
  HospitalInput,
  HospitalUpdate,
  Hospitals,
  PartnerHandover,
  PartnerHandoverDetail,
  PartnerHandovers,
  PreferredHospital,
  type ErrorBody as ErrorBodyT,
  type Hospital as HospitalT,
} from '@repo/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { checkLimits } from '../../lib/rate-limit';
import { requireAuth, requireStaff } from '../../middleware/auth';
import { canActFor } from '../households/service';
import { isSosFailure, type SosFailure } from '../sos/transition';
import type { IncidentRow } from '../sos/repo';
import { LINK_TOKEN } from './policy';
import type { HospitalRow } from './repo';
import { hospitalsNear, linkView, partnerConfirm, partnerDetail, partnerList, redirectHandover, saveFirstAidNotes, toSummary } from './service';

const security = [{ bearer: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { content: { 'application/json': { schema } }, required: true } });
const failures = {
  400: json(ErrorBody, 'Invalid'),
  401: json(ErrorBody, 'Not signed in'),
  403: json(ErrorBody, 'Not allowed'),
  404: json(ErrorBody, 'Not found'),
  409: json(ErrorBody, 'Not possible now'),
};
const statusOf: Record<SosFailure['error'], 400 | 403 | 404 | 409> = {
  not_found: 404,
  forbidden: 403,
  illegal_transition: 409,
  not_your_move: 403,
  reason_required: 400,
  conflict: 409,
};
const failure = (c: Context<AppEnv>, f: SosFailure) =>
  c.json({ error: { code: f.error, message: f.message, requestId: c.get('requestId') } } satisfies ErrorBodyT, statusOf[f.error]);
const idParam = { params: z.object({ id: z.string().uuid() }) };
const person = { params: z.object({ userId: z.string().uuid() }) };

const authed = { security, middleware: [requireAuth] };
const partner = { security, middleware: [requireAuth, requireStaff(['hospital'])] };
const hospitalAdmin = { security, middleware: [requireAuth, requireStaff(['super_admin', 'operations'])] };

const toHospital = (h: HospitalRow): HospitalT => ({
  id: h.id,
  name: h.name,
  address: h.address,
  city: h.city,
  location: { lat: h.lat, lng: h.lng },
  erPhone: h.erPhone,
  hasCapacity: h.hasCapacity,
  capacityUpdatedAt: h.capacityUpdatedAt?.toISOString() ?? null,
  active: h.active,
});

/** The hospitals this partner user works for; none means the account is not linked to one yet. */
async function partnerOf(c: Context<AppEnv>): Promise<{ id: string; hospitalIds: string[] } | SosFailure> {
  const auth = c.get('auth')!;
  const hospitalIds = await c.get('deps').handovers.partnerHospitals(auth.userId);
  return hospitalIds.length > 0
    ? { id: auth.userId, hospitalIds }
    : { error: 'forbidden', message: 'This account is not linked to a hospital yet. Ask operations to link it.' };
}

/** The crew's own job: the incident must be theirs. */
async function crewJob(c: Context<AppEnv>, incidentId: string): Promise<{ userId: string; incident: IncidentRow } | SosFailure> {
  const auth = c.get('auth')!;
  const deps = c.get('deps');
  const crew = auth.roles.includes('crew') ? await deps.dispatch.crewByUser(auth.userId) : null;
  if (!crew?.active) return { error: 'forbidden', message: 'This account is not set up as ambulance crew.' };
  const incident = await deps.sos.get(incidentId);
  return incident && incident.crewId === crew.id ? { userId: auth.userId, incident } : { error: 'not_found', message: 'No such job.' };
}

const r = {
  partnerList: createRoute({
    method: 'get',
    path: '/partner/handovers',
    operationId: 'partnerHandovers',
    tags: ['handover'],
    summary: 'Hospital: incoming SOS handovers of the last day, with arrival ETA',
    ...partner,
    responses: { 200: json(PartnerHandovers, 'Handovers'), ...failures },
  }),
  partnerGet: createRoute({
    method: 'get',
    path: '/partner/handovers/{id}',
    operationId: 'partnerHandover',
    tags: ['handover'],
    summary: 'Hospital: one handover with the consented record (while the link is live). Every opening is logged in record_shares.',
    ...partner,
    request: idParam,
    responses: { 200: json(PartnerHandoverDetail, 'Handover'), ...failures },
  }),
  partnerConfirm: createRoute({
    method: 'post',
    path: '/partner/handovers/{id}/confirm',
    operationId: 'confirmHandover',
    tags: ['handover'],
    summary: 'Hospital: confirm the patient was received',
    ...partner,
    request: idParam,
    responses: { 200: json(PartnerHandover, 'Confirmed'), ...failures },
  }),
  capacity: createRoute({
    method: 'put',
    path: '/partner/capacity',
    operationId: 'setHospitalCapacity',
    tags: ['handover'],
    summary: 'Hospital: ER accepting patients, or full (full hospitals are skipped when choosing)',
    ...partner,
    request: body(HospitalCapacity),
    responses: { 200: json(Hospital, 'Updated'), ...failures },
  }),
  link: createRoute({
    method: 'get',
    path: '/handover-links/{token}',
    operationId: 'handoverLink',
    tags: ['handover'],
    summary: 'The ER opens the signed, expiring handover link (no sign-in; rate limited; every view logged)',
    request: { params: z.object({ token: z.string() }) },
    responses: { 200: json(HandoverLinkView, 'Handover'), 404: json(ErrorBody, 'Expired or not valid'), 429: json(ErrorBody, 'Too many requests') },
  }),
  crewHospitals: createRoute({
    method: 'get',
    path: '/sos/{id}/hospitals',
    operationId: 'crewHospitals',
    tags: ['handover'],
    summary: 'Crew: every active hospital, nearest to the patient first, with ER full / accepting and the person’s preferred one marked (plan §11)',
    ...authed,
    request: idParam,
    responses: {
      200: json(
        z.object({ hospitals: z.array(NearbyHospital) }),
        'Hospitals',
      ),
      ...failures,
    },
  }),
  crewRedirect: createRoute({
    method: 'put',
    path: '/sos/{id}/hospital',
    operationId: 'crewRedirectHospital',
    tags: ['handover'],
    summary: 'Crew: pick the receiving hospital, which opens the handover (no reason needed the first time), or change it with a reason (a new link is issued, the old one stops working)',
    ...authed,
    request: { ...idParam, ...body(HandoverRedirect) },
    responses: { 200: json(HandoverSummary, 'Updated'), ...failures },
  }),
  notes: createRoute({
    method: 'post',
    path: '/sos/{id}/first-aid-notes',
    operationId: 'saveFirstAidNotes',
    tags: ['handover'],
    summary: 'Crew: first-aid notes, added to the hospital handover (replaces earlier notes)',
    ...authed,
    request: { ...idParam, ...body(FirstAidNotes) },
    responses: { 204: { description: 'Saved' }, ...failures },
  }),
  hospitals: createRoute({
    method: 'get',
    path: '/hospitals',
    operationId: 'listHospitals',
    tags: ['handover'],
    summary: 'Network hospitals (super admin, operations)',
    ...hospitalAdmin,
    responses: { 200: json(Hospitals, 'Hospitals'), ...failures },
  }),
  addHospital: createRoute({
    method: 'post',
    path: '/hospitals',
    operationId: 'addHospital',
    tags: ['handover'],
    summary: 'Add a network hospital',
    ...hospitalAdmin,
    request: body(HospitalInput),
    responses: { 201: json(Hospital, 'Added'), ...failures },
  }),
  editHospital: createRoute({
    method: 'patch',
    path: '/hospitals/{id}',
    operationId: 'updateHospital',
    tags: ['handover'],
    summary: 'Edit a hospital, set its capacity, or deactivate it',
    ...hospitalAdmin,
    request: { ...idParam, ...body(HospitalUpdate) },
    responses: { 200: json(Hospital, 'Updated'), ...failures },
  }),
  choices: createRoute({
    method: 'get',
    path: '/people/{userId}/preferred-hospital',
    operationId: 'preferredHospital',
    tags: ['handover'],
    summary: 'Network hospitals to choose from, and the preferred one',
    ...authed,
    request: person,
    responses: { 200: json(HospitalChoices, 'Choices'), ...failures },
  }),
  prefer: createRoute({
    method: 'put',
    path: '/people/{userId}/preferred-hospital',
    operationId: 'setPreferredHospital',
    tags: ['handover'],
    summary: 'Preferred hospital for an emergency (used if no more than 10 minutes further than the nearest with capacity)',
    ...authed,
    request: { ...person, ...body(PreferredHospital) },
    responses: { 200: json(HospitalChoices, 'Saved'), ...failures },
  }),
};

const choicesFor = async (c: Context<AppEnv>, userId: string) => {
  const { handovers } = c.get('deps');
  const [all, preferredId] = await Promise.all([handovers.hospitals(), handovers.preferredHospital(userId)]);
  return { hospitals: all.filter((h) => h.active).map((h) => ({ id: h.id, name: h.name, city: h.city })), preferredId };
};

const managing = async (c: Context<AppEnv>, userId: string): Promise<SosFailure | null> =>
  (await canActFor(c.get('deps').households, c.get('auth')!.userId, userId)) ? null : { error: 'forbidden', message: 'You do not manage this person’s care.' };

export const handoverRoutes = new OpenAPIHono<AppEnv>()
  // Registered before the partner detail, so the HandoverRecord component itself is not nullable.
  .openapi(r.link, async (c) => {
    const deps = c.get('deps');
    // Per client address: guessing tokens is hopeless (256 bits), this keeps scanners off the database.
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const limited = await checkLimits(deps.kv, `handover-link:${ip}`, [{ limit: 30, windowSeconds: 60 }]);
    if (!limited.ok) {
      c.header('retry-after', String(limited.retryAfterSeconds));
      return c.json(
        { error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.', requestId: c.get('requestId') } } satisfies ErrorBodyT,
        429,
      );
    }
    const { token } = c.req.valid('param');
    // Never cached by the browser or a proxy: it carries health data.
    c.header('cache-control', 'no-store');
    const view = LINK_TOKEN.test(token)
      ? await linkView(deps, token)
      : ({ error: 'not_found', message: 'This link has expired or is not valid. Ask the ambulance crew or the control room.' } as const);
    return isSosFailure(view)
      ? c.json({ error: { code: view.error, message: view.message, requestId: c.get('requestId') } } satisfies ErrorBodyT, 404)
      : c.json(view, 200);
  })
  .openapi(r.partnerList, async (c) => {
    const p = await partnerOf(c);
    if (isSosFailure(p)) return failure(c, p);
    const deps = c.get('deps');
    const hospital = (await deps.handovers.hospital(p.hospitalIds[0]!))!;
    const handovers = (await Promise.all(p.hospitalIds.map((id) => partnerList(deps, id)))).flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return c.json(
      {
        hospital: {
          id: hospital.id,
          name: hospital.name,
          hasCapacity: hospital.hasCapacity,
          capacityUpdatedAt: hospital.capacityUpdatedAt?.toISOString() ?? null,
        },
        handovers,
      },
      200,
    );
  })
  .openapi(r.partnerGet, async (c) => {
    const p = await partnerOf(c);
    if (isSosFailure(p)) return failure(c, p);
    const done = await partnerDetail(c.get('deps'), p, c.req.valid('param').id);
    return isSosFailure(done) ? failure(c, done) : c.json(done, 200);
  })
  .openapi(r.partnerConfirm, async (c) => {
    const p = await partnerOf(c);
    if (isSosFailure(p)) return failure(c, p);
    const done = await partnerConfirm(c.get('deps'), p, c.req.valid('param').id);
    return isSosFailure(done) ? failure(c, done) : c.json(done, 200);
  })
  .openapi(r.capacity, async (c) => {
    const p = await partnerOf(c);
    if (isSosFailure(p)) return failure(c, p);
    const row = await c
      .get('deps')
      .handovers.updateHospital({ id: p.id, role: 'hospital' }, p.hospitalIds[0]!, { hasCapacity: c.req.valid('json').hasCapacity });
    return row ? c.json(toHospital(row), 200) : failure(c, { error: 'not_found', message: 'No such hospital.' });
  })
  .openapi(r.crewHospitals, async (c) => {
    const job = await crewJob(c, c.req.valid('param').id);
    if (isSosFailure(job)) return failure(c, job);
    return c.json({ hospitals: await hospitalsNear(c.get('deps'), job.incident) }, 200);
  })
  .openapi(r.crewRedirect, async (c) => {
    const job = await crewJob(c, c.req.valid('param').id);
    if (isSosFailure(job)) return failure(c, job);
    const { hospitalId, reason } = c.req.valid('json');
    const done = await redirectHandover(c.get('deps'), job.incident, hospitalId, reason ?? null, { id: job.userId, role: 'crew' });
    return isSosFailure(done) ? failure(c, done) : c.json(toSummary(done), 200);
  })
  .openapi(r.notes, async (c) => {
    const job = await crewJob(c, c.req.valid('param').id);
    if (isSosFailure(job)) return failure(c, job);
    const done = await saveFirstAidNotes(c.get('deps'), job.incident, c.req.valid('json').notes);
    return isSosFailure(done) ? failure(c, done) : c.body(null, 204);
  })
  .openapi(r.hospitals, async (c) => c.json({ hospitals: (await c.get('deps').handovers.hospitals()).map(toHospital) }, 200))
  .openapi(r.addHospital, async (c) => {
    const b = c.req.valid('json');
    const row = await c
      .get('deps')
      .handovers.createHospital(c.get('auth')!.userId, {
        name: b.name,
        address: b.address ?? null,
        city: b.city ?? null,
        lat: b.location.lat,
        lng: b.location.lng,
        erPhone: b.erPhone,
      });
    return c.json(toHospital(row), 201);
  })
  .openapi(r.editHospital, async (c) => {
    const { location, address, city, ...rest } = c.req.valid('json');
    const auth = c.get('auth')!;
    const role = auth.roles.find((x) => x === 'super_admin' || x === 'operations')!;
    const patch = {
      ...rest,
      ...(address !== undefined ? { address: address || null } : {}),
      ...(city !== undefined ? { city: city || null } : {}),
      ...(location ? { lat: location.lat, lng: location.lng } : {}),
    };
    if (Object.keys(patch).length === 0) return failure(c, { error: 'reason_required', message: 'Nothing to change.' });
    const row = await c.get('deps').handovers.updateHospital({ id: auth.userId, role }, c.req.valid('param').id, patch);
    return row ? c.json(toHospital(row), 200) : failure(c, { error: 'not_found', message: 'No such hospital.' });
  })
  .openapi(r.choices, async (c) => {
    const { userId } = c.req.valid('param');
    const denied = await managing(c, userId);
    return denied ? failure(c, denied) : c.json(await choicesFor(c, userId), 200);
  })
  .openapi(r.prefer, async (c) => {
    const { userId } = c.req.valid('param');
    const denied = await managing(c, userId);
    if (denied) return failure(c, denied);
    const { hospitalId } = c.req.valid('json');
    const deps = c.get('deps');
    if (hospitalId && !(await deps.handovers.hospital(hospitalId))?.active) return failure(c, { error: 'not_found', message: 'No such hospital.' });
    await deps.handovers.setPreferredHospital(c.get('auth')!.userId, userId, hospitalId);
    return c.json(await choicesFor(c, userId), 200);
  });
