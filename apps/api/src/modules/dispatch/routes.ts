import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { CrewDuty, CrewJob, type CrewJob as CrewJobT, CrewLocation, CrewStatus, CrewStepUpdate, DispatchOffer, ErrorBody, SosIncident, type ErrorBody as ErrorBodyT } from '@repo/contracts';
import { nextCrewStep } from '@repo/contracts/sos';
import type { Context } from 'hono';
import type { AppEnv } from '../../app';
import { requireAuth } from '../../middleware/auth';
import { toIncident } from '../sos/service';
import { isSosFailure, type SosFailure } from '../sos/transition';
import type { EventRow, IncidentRow } from '../sos/repo';
import type { CrewRow } from './repo';
import { acceptOffer, advanceJob, declineOffer, reportLocation, setDuty } from './service';

const security = [{ bearer: [] }];
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { 'application/json': { schema } } });
const failures = { 400: json(ErrorBody, 'Invalid'), 401: json(ErrorBody, 'Not signed in'), 403: json(ErrorBody, 'Not ambulance crew'), 404: json(ErrorBody, 'Not found'), 409: json(ErrorBody, 'Not possible now') };
const authed = { security, middleware: [requireAuth] };
const statusOf: Record<SosFailure['error'], 400 | 403 | 404 | 409> = { not_found: 404, forbidden: 403, illegal_transition: 409, not_your_move: 403, reason_required: 400, conflict: 409 };
const failure = (c: Context<AppEnv>, f: SosFailure) => c.json({ error: { code: f.error, message: f.message, requestId: c.get('requestId') } } satisfies ErrorBodyT, statusOf[f.error]);
const offerParam = { params: z.object({ id: z.string().uuid() }) };
const incidentParam = offerParam;

/** The signed-in person's crew record: the crew role and an active crew row (set up by ops). */
async function crewOf(c: Context<AppEnv>): Promise<CrewRow | SosFailure> {
  const auth = c.get('auth')!;
  const crew = auth.roles.includes('crew') ? await c.get('deps').dispatch.crewByUser(auth.userId) : null;
  return crew?.active ? crew : { error: 'forbidden', message: 'This account is not set up as ambulance crew.' };
}

const r = {
  me: createRoute({ method: 'get', path: '/crew/me', operationId: 'crewStatus', tags: ['dispatch'], summary: 'My crew record: duty status and team', ...authed, responses: { 200: json(CrewStatus, 'Crew'), ...failures } }),
  duty: createRoute({
    method: 'put',
    path: '/crew/duty',
    operationId: 'setCrewDuty',
    tags: ['dispatch'],
    summary: 'Go on or off duty (on duty with a location = offered SOS jobs nearby)',
    ...authed,
    request: { body: { content: { 'application/json': { schema: CrewDuty } }, required: true } },
    responses: { 200: json(CrewStatus, 'Updated'), ...failures },
  }),
  location: createRoute({
    method: 'post',
    path: '/crew/location',
    operationId: 'reportCrewLocation',
    tags: ['dispatch'],
    summary: 'Batched location fixes while on duty',
    ...authed,
    request: { body: { content: { 'application/json': { schema: CrewLocation } }, required: true } },
    responses: { 204: { description: 'Recorded' }, ...failures },
  }),
  offers: createRoute({ method: 'get', path: '/crew/offers', operationId: 'crewOffers', tags: ['dispatch'], summary: 'SOS jobs offered to me and still open', ...authed, responses: { 200: json(z.array(DispatchOffer), 'Open offers'), ...failures } }),
  accept: createRoute({
    method: 'post',
    path: '/dispatch/offers/{id}/accept',
    operationId: 'acceptOffer',
    tags: ['dispatch'],
    summary: 'Take the job. The first crew to accept wins; others get 409.',
    ...authed,
    request: offerParam,
    responses: { 200: json(SosIncident, 'Job is yours'), ...failures },
  }),
  job: createRoute({
    method: 'get',
    path: '/crew/job',
    operationId: 'crewJob',
    tags: ['dispatch'],
    summary: 'The job I have taken and not yet handed over (the app checks this on launch)',
    ...authed,
    responses: { 200: json(CrewJob.nullable(), 'Job or null'), ...failures },
  }),
  step: createRoute({
    method: 'post',
    path: '/sos/{id}/status',
    operationId: 'advanceCrewJob',
    tags: ['dispatch'],
    summary: 'Crew status button: en route → on scene → transporting → handed over (assigned crew only)',
    ...authed,
    request: { ...incidentParam, body: { content: { 'application/json': { schema: CrewStepUpdate } }, required: true } },
    responses: { 200: json(CrewJob, 'Updated'), ...failures },
  }),
  decline: createRoute({ method: 'post', path: '/dispatch/offers/{id}/decline', operationId: 'declineOffer', tags: ['dispatch'], summary: 'Decline an offered job', ...authed, request: offerParam, responses: { 204: { description: 'Declined' }, ...failures } }),
};

const toJob = (i: IncidentRow, events: EventRow[]): CrewJobT => ({ incident: toIncident(i, events), nextStep: nextCrewStep(i.state) });

const status = async (c: Context<AppEnv>, crew: CrewRow) => ({ crewId: crew.id, onDuty: await c.get('deps').dispatch.isOnDuty(crew.id), team: crew.teamName, drillParticipant: crew.drillParticipant });

export const dispatchRoutes = new OpenAPIHono<AppEnv>()
  .openapi(r.me, async (c) => {
    const crew = await crewOf(c);
    if (isSosFailure(crew)) return failure(c, crew);
    return c.json(await status(c, crew), 200);
  })
  .openapi(r.duty, async (c) => {
    const crew = await crewOf(c);
    if (isSosFailure(crew)) return failure(c, crew);
    const { onDuty, location } = c.req.valid('json');
    const done = await setDuty(c.get('deps'), crew, onDuty, location);
    if (isSosFailure(done)) return failure(c, done);
    return c.json(await status(c, crew), 200);
  })
  .openapi(r.location, async (c) => {
    const crew = await crewOf(c);
    if (isSosFailure(crew)) return failure(c, crew);
    const done = await reportLocation(c.get('deps'), crew, c.req.valid('json').points);
    if (isSosFailure(done)) return failure(c, done);
    return c.body(null, 204);
  })
  .openapi(r.offers, async (c) => {
    const crew = await crewOf(c);
    if (isSosFailure(crew)) return failure(c, crew);
    const deps = c.get('deps');
    const pending = await deps.dispatch.pendingForCrew(crew.id);
    const offers = await Promise.all(
      pending.map(async (o) => ({
        id: o.id,
        incidentId: o.incidentId,
        ring: o.ring,
        offeredAt: o.createdAt.toISOString(),
        isDrill: o.isDrill,
        location: o.location,
        distanceM: o.location ? ((await deps.locator.distances(o.location, [crew.id])).get(crew.id) ?? null) : null,
        etaS: o.etaS,
      })),
    );
    return c.json(offers, 200);
  })
  .openapi(r.accept, async (c) => {
    const crew = await crewOf(c);
    if (isSosFailure(crew)) return failure(c, crew);
    const deps = c.get('deps');
    const done = await acceptOffer(deps, crew, c.req.valid('param').id);
    if (isSosFailure(done)) return failure(c, done);
    return c.json(toIncident(done, await deps.sos.events(done.id)), 200);
  })
  // Registered before the nullable job route, so the CrewJob component itself is not nullable.
  .openapi(r.step, async (c) => {
    const crew = await crewOf(c);
    if (isSosFailure(crew)) return failure(c, crew);
    const deps = c.get('deps');
    const done = await advanceJob(deps, crew, c.req.valid('param').id, c.req.valid('json').to);
    if (isSosFailure(done)) return failure(c, done);
    return c.json(toJob(done, await deps.sos.events(done.id)), 200);
  })
  .openapi(r.job, async (c) => {
    const crew = await crewOf(c);
    if (isSosFailure(crew)) return failure(c, crew);
    const deps = c.get('deps');
    const job = await deps.sos.activeForCrew(crew.id);
    return c.json(job ? toJob(job, await deps.sos.events(job.id)) : null, 200);
  })
  .openapi(r.decline, async (c) => {
    const crew = await crewOf(c);
    if (isSosFailure(crew)) return failure(c, crew);
    const done = await declineOffer(c.get('deps'), crew, c.req.valid('param').id);
    if (isSosFailure(done)) return failure(c, done);
    return c.body(null, 204);
  });
