import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memoryKv } from '../src/lib/kv';
import { memoryCrewLocator, type LatLng } from '../src/lib/crew-locator';
import { acceptOffer, chooseCandidates, declineOffer, dispatchAlerts, estimateEtaS } from '../src/modules/dispatch/service';
import { beginDispatch } from '../src/modules/sos/escalation-service';
import { move, raise } from '../src/modules/sos/service';
import { fakeDispatch } from './fake-dispatch';
import { fakeEscalation, fakeSos } from './fake-sos';
import { fakeHouseholds } from './fake-households';
import { testContext } from './helpers';

const MOM = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const HOME: LatLng = { lat: 17.44, lng: 78.35 };
/** A point `km` kilometres north of HOME. */
const north = (km: number): LatLng => ({ lat: HOME.lat + km / 111.2, lng: HOME.lng });

async function setup(opts: { location?: LatLng | null; isDrill?: boolean; householdId?: string } = {}) {
  const sos = fakeSos();
  const dispatch = fakeDispatch(() => sos.incidents);
  const locator = memoryCrewLocator();
  const kv = memoryKv();
  const escalation = fakeEscalation();
  const location = opts.location === undefined ? HOME : opts.location;
  const { incident } = await raise({ sos: sos.repo, households: fakeHouseholds([]).repo }, { id: MOM, role: 'resident' }, MOM, { idempotencyKey: randomUUID(), ...(location ? { location } : {}) }, { isDrill: opts.isDrill });
  // The fake households repo has no membership; attach a household directly.
  const row = sos.incidents[0]!;
  row.householdId = opts.householdId ?? null;
  const d = { dispatch: dispatch.repo, locator, kv, sos: sos.repo, escalation: escalation.runner };
  await beginDispatch({ sos: sos.repo, alerts: { offerRing: async () => {}, alertDesk: async () => {}, prompt108: async () => {} } }, incident.id);
  const current = () => sos.incidents[0]!;
  /** A crew on duty at `at` (no position if `at` is null). */
  const crewAt = async (at: LatLng | null, p: Parameters<typeof dispatch.addCrew>[0] = {}) => {
    const c = dispatch.addCrew(p);
    if (at) await locator.set(c.id, at);
    return c;
  };
  return { sos, dispatch, locator, d, current, crewAt, escalation };
}

describe('who is offered an SOS', () => {
  it('no coverage team: the nearest three available crews, with distance and ETA', async () => {
    const t = await setup();
    const near = await t.crewAt(north(1));
    const mid = await t.crewAt(north(3));
    const far = await t.crewAt(north(6));
    await t.crewAt(north(9));
    const ring = await chooseCandidates(t.d, t.current(), 1);
    expect(ring.map((c) => c.crewId)).toEqual([near.id, mid.id, far.id]);
    expect(ring[0]).toMatchObject({ ring: 1, team: false, distanceM: expect.closeTo(1000, -2) });
    expect(ring[0]!.etaS).toBe(estimateEtaS(ring[0]!.distanceM!));
  });

  it("the household's team comes first, even when farther away or without a position, topped up with the nearest others", async () => {
    const t = await setup({ householdId: 'hh-1' });
    const team = t.dispatch.addTeam('ABC · Gachibowli');
    t.dispatch.householdTeam.set('hh-1', team);
    const teamFar = await t.crewAt(north(8), { teamId: team });
    const teamNoGps = await t.crewAt(null, { teamId: team });
    const other1 = await t.crewAt(north(1));
    await t.crewAt(north(2));
    const ring = await chooseCandidates(t.d, t.current(), 1);
    expect(ring.map((c) => [c.crewId, c.team])).toEqual([
      [teamFar.id, true],
      [teamNoGps.id, true],
      [other1.id, false],
    ]);
  });

  it('a community covered through its site counts for every household in it', async () => {
    const t = await setup({ householdId: 'hh-villa' });
    const team = t.dispatch.addTeam('XYZ');
    t.dispatch.householdSite.set('hh-villa', 'site-1');
    t.dispatch.siteTeam.set('site-1', team);
    const member = await t.crewAt(north(5), { teamId: team });
    expect((await chooseCandidates(t.d, t.current(), 1))[0]).toMatchObject({ crewId: member.id, team: true });
  });

  it('an inactive team is ignored', async () => {
    const t = await setup({ householdId: 'hh-1' });
    const team = t.dispatch.addTeam('Old', false);
    t.dispatch.householdTeam.set('hh-1', team);
    await t.crewAt(north(5), { teamId: team });
    const near = await t.crewAt(north(1));
    expect((await chooseCandidates(t.d, t.current(), 1)).map((c) => c.crewId)).toEqual([near.id, expect.any(String)]);
  });

  it('skips crews that are off duty, inactive, on another job, or beyond the search radius', async () => {
    const t = await setup();
    const off = t.dispatch.addCrew({}, { onDuty: false });
    await t.locator.set(off.id, north(1));
    await t.crewAt(north(1), { active: false });
    const busy = await t.crewAt(north(1));
    t.sos.incidents.push({ ...t.current(), id: randomUUID(), state: 'en_route', crewId: busy.id });
    await t.crewAt(north(30));
    const ok = await t.crewAt(north(2));
    expect((await chooseCandidates(t.d, t.current(), 1)).map((c) => c.crewId)).toEqual([ok.id]);
  });

  it('a drill is offered only to drill crews', async () => {
    const t = await setup({ isDrill: true });
    await t.crewAt(north(1));
    const drill = await t.crewAt(north(4), { drillParticipant: true });
    expect((await chooseCandidates(t.d, t.current(), 1)).map((c) => c.crewId)).toEqual([drill.id]);
  });

  it("without GPS the household's home location is used", async () => {
    const t = await setup({ location: null, householdId: 'hh-1' });
    t.dispatch.householdAt.set('hh-1', HOME);
    const near = await t.crewAt(north(1));
    expect((await chooseCandidates(t.d, t.current(), 1)).map((c) => c.crewId)).toEqual([near.id]);
  });

  it('ring 2 goes to the next nearest crews, never re-offering ring 1', async () => {
    const t = await setup();
    const crews = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((km) => t.crewAt(north(km))));
    const alerts = dispatchAlerts(t.d);
    await alerts.offerRing(t.current(), 1);
    await alerts.offerRing(t.current(), 2);
    expect(t.dispatch.offers.map((o) => [o.ring, o.crewId])).toEqual([
      [1, crews[0]!.id],
      [1, crews[1]!.id],
      [1, crews[2]!.id],
      [2, crews[3]!.id],
      [2, crews[4]!.id],
      [2, crews[5]!.id],
    ]);
    expect(t.sos.audit.filter((a) => a.action === 'sos_offers_sent')).toHaveLength(2);
  });

  it('no crews at all: no offers, and nothing breaks', async () => {
    const t = await setup();
    await dispatchAlerts(t.d).offerRing(t.current(), 1);
    expect(t.dispatch.offers).toEqual([]);
  });
});

describe('accepting and declining', () => {
  async function offered(n: number) {
    const t = await setup();
    const crews = await Promise.all(Array.from({ length: n }, (_, i) => t.crewAt(north(i + 1))));
    await dispatchAlerts(t.d).offerRing(t.current(), 1);
    const offerOf = (crewId: string) => t.dispatch.offers.find((o) => o.crewId === crewId)!.id;
    return { ...t, crews, offerOf };
  }

  it('the crew gets the job; the other offers are released and the escalation run is told to stop', async () => {
    const t = await offered(3);
    const res = await acceptOffer(t.d, t.crews[1]!, t.offerOf(t.crews[1]!.id));
    expect(res).toMatchObject({ state: 'accepted', crewId: t.crews[1]!.id });
    expect(t.dispatch.offers.map((o) => o.response)).toEqual(['released', 'accepted', 'released']);
    expect(t.escalation.signals).toEqual([{ incidentId: t.current().id, signal: { kind: 'settled', state: 'accepted' } }]);
  });

  it('three crews accept at the same moment: exactly one wins', async () => {
    const t = await offered(3);
    const results = await Promise.all(t.crews.map((c) => acceptOffer(t.d, c, t.offerOf(c.id))));
    expect(results.filter((r) => 'state' in r)).toHaveLength(1);
    expect(results.filter((r) => 'error' in r && r.error === 'conflict')).toHaveLength(2);
    expect(t.sos.events.get(t.current().id)!.filter((e) => e.toState === 'accepted')).toHaveLength(1);
  });

  it('a crew cannot accept someone else’s offer', async () => {
    const t = await offered(2);
    expect(await acceptOffer(t.d, t.crews[0]!, t.offerOf(t.crews[1]!.id))).toMatchObject({ error: 'not_found' });
  });

  it('an SOS cancelled after the offer cannot be accepted', async () => {
    const t = await offered(1);
    t.current().state = 'cancelled';
    expect(await acceptOffer(t.d, t.crews[0]!, t.offerOf(t.crews[0]!.id))).toMatchObject({ error: 'conflict' });
  });

  it('declining closes only that offer; a second answer is refused', async () => {
    const t = await offered(2);
    expect(await declineOffer(t.d, t.crews[0]!, t.offerOf(t.crews[0]!.id))).toBe(true);
    expect(await declineOffer(t.d, t.crews[0]!, t.offerOf(t.crews[0]!.id))).toMatchObject({ error: 'conflict' });
    expect(t.dispatch.offers.map((o) => o.response)).toEqual(['declined', null]);
  });
});

describe('crew endpoints', () => {
  const CREW_USER = 'c1000000-0000-4000-8000-000000000001';

  async function crewClient(roles: string[] = ['crew']) {
    const t = await testContext();
    const crew = t.dispatch.addCrew({ userId: CREW_USER }, { onDuty: false });
    const h = { authorization: `Bearer ${await t.token({ sub: CREW_USER, app_roles: roles })}`, 'content-type': 'application/json' };
    const call = (method: string, p: string, b?: unknown) => t.app.request(p, { method, headers: h, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    return { t, crew, call };
  }

  it('only accounts with the crew role and a crew record get in', async () => {
    const { call } = await crewClient(['phlebotomist']);
    expect((await call('GET', '/v1/crew/me')).status).toBe(403);
    const t = await testContext();
    const noRecord = await t.app.request('/v1/crew/me', { headers: { authorization: `Bearer ${await t.token({ sub: randomUUID(), app_roles: ['crew'] })}` } });
    expect(noRecord.status).toBe(403);
  });

  it('on duty with a location makes the crew findable; off duty removes them', async () => {
    const { t, crew, call } = await crewClient();
    const on = await call('PUT', '/v1/crew/duty', { onDuty: true, location: north(1) });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ crewId: crew.id, onDuty: true });
    expect(await t.locator.nearby(HOME, 5000, 3)).toEqual([{ crewId: crew.id, distanceM: expect.any(Number) }]);
    await call('PUT', '/v1/crew/duty', { onDuty: false });
    expect(await t.locator.nearby(HOME, 5000, 3)).toEqual([]);
    expect(t.dispatch.audit.map((a) => a.action)).toEqual(['crew_on_duty', 'crew_off_duty']);
  });

  it('location updates are accepted only on duty; the newest fix wins', async () => {
    const { t, crew, call } = await crewClient();
    const fix = (p: LatLng, at: string) => ({ ...p, at });
    expect((await call('POST', '/v1/crew/location', { points: [fix(north(1), '2026-10-27T10:00:00Z')] })).status).toBe(409);
    await call('PUT', '/v1/crew/duty', { onDuty: true });
    const res = await call('POST', '/v1/crew/location', { points: [fix(north(2), '2026-10-27T10:00:05Z'), fix(north(1), '2026-10-27T10:00:00Z')] });
    expect(res.status).toBe(204);
    expect((await t.locator.distances(HOME, [crew.id])).get(crew.id)).toBeCloseTo(2000, -2);
  });

  it('a raised SOS shows up as an offer, and the crew can take it', async () => {
    const { t, crew, call } = await crewClient();
    await call('PUT', '/v1/crew/duty', { onDuty: true, location: north(1) });
    const resident = { authorization: `Bearer ${await t.token({ sub: MOM })}`, 'content-type': 'application/json' };
    const sos = (await (await t.app.request('/v1/sos', { method: 'POST', headers: resident, body: JSON.stringify({ idempotencyKey: randomUUID(), location: HOME }) })).json()) as { id: string };
    // What the escalation workflow does when it starts.
    const d = { dispatch: t.dispatch.repo, locator: t.locator, sos: t.sos.repo };
    await beginDispatch({ sos: t.sos.repo, alerts: dispatchAlerts(d) }, sos.id);

    const offers = (await (await call('GET', '/v1/crew/offers')).json()) as { id: string; incidentId: string; distanceM: number; isDrill: boolean }[];
    expect(offers).toEqual([expect.objectContaining({ incidentId: sos.id, isDrill: false, distanceM: expect.closeTo(1000, -2) })]);
    expect(Object.keys(offers[0]!)).not.toContain('allergies');

    const taken = await call('POST', `/v1/dispatch/offers/${offers[0]!.id}/accept`);
    expect(taken.status).toBe(200);
    expect(await taken.json()).toMatchObject({ id: sos.id, state: 'accepted' });
    expect(t.sos.incidents[0]!.crewId).toBe(crew.id);
    expect((await (await call('GET', '/v1/crew/offers')).json()) as unknown[]).toEqual([]);
  });
});

describe('the crew job', () => {
  const CREW_USER = 'c1000000-0000-4000-8000-000000000002';

  /** A crew that has accepted a freshly raised SOS, driven through the HTTP API. */
  async function onJob(opts: { isDrill?: boolean } = {}) {
    const t = await testContext();
    const crew = t.dispatch.addCrew({ userId: CREW_USER, drillParticipant: opts.isDrill ?? false }, { onDuty: false });
    const h = { authorization: `Bearer ${await t.token({ sub: CREW_USER, app_roles: ['crew'] })}`, 'content-type': 'application/json' };
    const call = (method: string, p: string, b?: unknown) => t.app.request(p, { method, headers: h, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    await call('PUT', '/v1/crew/duty', { onDuty: true, location: north(1) });
    const { incident } = await raise({ sos: t.sos.repo, households: t.hh.repo }, { id: MOM, role: 'resident' }, MOM, { idempotencyKey: randomUUID(), location: HOME }, { isDrill: opts.isDrill });
    await beginDispatch({ sos: t.sos.repo, alerts: dispatchAlerts({ dispatch: t.dispatch.repo, locator: t.locator, sos: t.sos.repo }) }, incident.id);
    const [offer] = (await (await call('GET', '/v1/crew/offers')).json()) as { id: string }[];
    expect((await call('POST', `/v1/dispatch/offers/${offer!.id}/accept`)).status).toBe(200);
    const step = (to: string, id = incident.id) => call('POST', `/v1/sos/${id}/status`, { to });
    return { t, crew, call, step, incidentId: incident.id };
  }

  it('no job: null', async () => {
    const t = await testContext();
    t.dispatch.addCrew({ userId: CREW_USER });
    const res = await t.app.request('/v1/crew/job', { headers: { authorization: `Bearer ${await t.token({ sub: CREW_USER, app_roles: ['crew'] })}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('after accepting, the job shows with the next status button and no medical details', async () => {
    const { call, incidentId } = await onJob();
    const job = (await (await call('GET', '/v1/crew/job')).json()) as { incident: { id: string; state: string }; nextStep: string };
    expect(job).toMatchObject({ incident: { id: incidentId, state: 'accepted' }, nextStep: 'en_route' });
    expect(JSON.stringify(job)).not.toMatch(/allerg|condition|medic|blood/i);
  });

  it('status buttons go en route → on scene → transporting → handed over, each in the timeline as the crew', async () => {
    const { t, call, step, incidentId } = await onJob();
    const seen: unknown[] = [];
    for (const to of ['en_route', 'on_scene', 'transporting', 'handed_over']) {
      const res = await step(to);
      expect(res.status).toBe(200);
      seen.push(((await res.json()) as { nextStep: string | null }).nextStep);
    }
    expect(seen).toEqual(['on_scene', 'transporting', 'handed_over', null]);
    expect(t.sos.events.get(incidentId)!.filter((e) => e.actorRole === 'crew').map((e) => e.toState)).toEqual(['en_route', 'on_scene', 'transporting', 'handed_over']);
    // Handed over: the job is done for the crew, who can take the next one.
    expect(await (await call('GET', '/v1/crew/job')).json()).toBeNull();
  });

  it('pressing the same step twice (a retry) is harmless; skipping a step is refused', async () => {
    const { t, step, incidentId } = await onJob();
    expect((await step('en_route')).status).toBe(200);
    expect((await step('en_route')).status).toBe(200);
    expect(t.sos.events.get(incidentId)!.filter((e) => e.toState === 'en_route')).toHaveLength(1);
    expect((await step('transporting')).status).toBe(409);
  });

  it('only the assigned crew can move the job', async () => {
    const { t, step, incidentId } = await onJob();
    const other = t.dispatch.addCrew({ userId: 'c1000000-0000-4000-8000-000000000003' });
    const res = await t.app.request(`/v1/sos/${incidentId}/status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await t.token({ sub: other.userId, app_roles: ['crew'] })}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'en_route' }),
    });
    expect(res.status).toBe(404);
    expect((await step('en_route', randomUUID())).status).toBe(404);
  });

  it('a resident cannot use the crew status endpoint', async () => {
    const { t, incidentId } = await onJob();
    const res = await t.app.request(`/v1/sos/${incidentId}/status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await t.token({ sub: MOM })}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'en_route' }),
    });
    expect(res.status).toBe(403);
  });

  it('going off duty mid-job is refused; after hand-over it works', async () => {
    const { call, step } = await onJob();
    expect((await call('PUT', '/v1/crew/duty', { onDuty: false })).status).toBe(409);
    for (const to of ['en_route', 'on_scene', 'transporting', 'handed_over']) await step(to);
    expect((await call('PUT', '/v1/crew/duty', { onDuty: false })).status).toBe(200);
  });

  it('a job cancelled by the resident disappears from the crew app', async () => {
    const { t, call, incidentId } = await onJob();
    const incident = (await t.sos.repo.get(incidentId))!;
    await move(t.sos.repo, incident, 'cancelled', { id: MOM, role: 'resident' }, null);
    expect(await (await call('GET', '/v1/crew/job')).json()).toBeNull();
  });
});
