import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DeskIncidentDetail, DeskIncident } from '@repo/contracts';
import { dispatchAlerts } from '../src/modules/dispatch/service';
import { beginDispatch } from '../src/modules/sos/escalation-service';
import { testContext } from './helpers';

const OPS = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const SUPPORT = '33333333-3333-4333-8333-333333333333';
const A = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const B = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';
const HOME = { lat: 17.44, lng: 78.35 };
const north = (km: number) => ({ lat: HOME.lat + km / 111.2, lng: HOME.lng });

type Ctx = Awaited<ReturnType<typeof testContext>>;

/** Two communities; Lakshmi (A) lives in Green Meadows, which DESK covers; Venkat (B) in Palm Villas. */
async function setup() {
  const t = await testContext();
  const green = t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
  const palm = t.hh.addSite({ name: 'Palm Villas', kind: 'gated', city: 'Hyderabad', joinCode: 'PALM777', homes: [{ tower: null, number: '42' }] });
  await t.hh.repo.createHousehold({ homeId: (await t.hh.repo.findHome(green.id, 'B', '1204'))!.id, city: 'Hyderabad' }, A);
  await t.hh.repo.createHousehold({ homeId: (await t.hh.repo.findHome(palm.id, null, '42'))!.id, city: 'Hyderabad' }, B);
  await t.hh.repo.saveProfile(A, { fullName: 'Lakshmi Rao', language: 'te' });
  await t.hh.repo.saveProfile(B, { fullName: 'Venkat Reddy', language: 'en' });
  t.deskScopes.set(DESK, [green.id]);
  t.desk.sites.set(green.id, { name: 'Green Meadows', city: 'Hyderabad', centre: HOME });
  t.desk.sites.set(palm.id, { name: 'Palm Villas', city: 'Hyderabad', centre: north(5) });

  const as = async (sub: string, roles: string[], aal = 'aal2') => {
    const h = { authorization: `Bearer ${await t.token({ sub, aal, app_roles: roles })}`, 'content-type': 'application/json' };
    return {
      get: (p: string) => t.app.request(p, { headers: h }),
      post: (p: string, b: unknown = {}) => t.app.request(p, { method: 'POST', headers: h, body: JSON.stringify(b) }),
    };
  };
  const ops = await as(OPS, ['operations']);
  const desk = await as(DESK, ['community_desk']);
  /** A resident raises an SOS and the escalation run's first step puts it in dispatch. */
  const sos = async (who = A) => {
    const res = await (await as(who, [])).post('/v1/sos', { idempotencyKey: randomUUID(), location: HOME });
    const { id } = (await res.json()) as { id: string };
    await beginDispatch({ sos: t.deps.sos, alerts: dispatchAlerts({ dispatch: t.deps.dispatch, locator: t.locator, sos: t.deps.sos, realtime: t.deps.realtime }) }, id);
    return id;
  };
  /** A crew on duty near the home, signed in to the field app. */
  const crew = async (km = 1, p: { drillParticipant?: boolean } = {}) => {
    const userId = randomUUID();
    const c = t.dispatch.addCrew({ userId, ...p });
    await t.locator.set(c.id, north(km));
    const field = await as(userId, ['crew']);
    const offers = async () => (await (await field.get('/v1/crew/offers')).json()) as { id: string; incidentId: string; ring: number }[];
    const accept = async (incidentId: string) => {
      const o = (await offers()).find((x) => x.incidentId === incidentId);
      return o ? field.post(`/v1/dispatch/offers/${o.id}/accept`) : null;
    };
    return { ...c, field, offers, accept };
  };
  return { t, green, palm, as, ops, desk, sos, crew };
}

const detail = async (res: Response) => (await res.json()) as DeskIncidentDetail;
const list = async (res: Response) => ((await res.json()) as { incidents: DeskIncident[] }).incidents;

describe('who sees the command center', () => {
  it('operations see every open incident; the community desk only its own community', async () => {
    const s = await setup();
    const a = await s.sos(A);
    const b = await s.sos(B);
    expect((await list(await s.ops.get('/v1/desk/sos'))).map((i) => i.id).sort()).toEqual([a, b].sort());
    const mine = await list(await s.desk.get('/v1/desk/sos'));
    expect(mine.map((i) => i.id)).toEqual([a]);
    expect(mine[0]).toMatchObject({ ref: expect.stringMatching(/^SOS-[0-9A-F]{6}$/), state: 'dispatching', resident: { name: 'Lakshmi Rao', community: 'Green Meadows', tower: 'B', number: '1204' } });
    // Another community's incident looks like it doesn't exist.
    expect((await s.desk.get(`/v1/desk/sos/${b}`)).status).toBe(404);
    expect((await s.desk.post(`/v1/desk/sos/${b}/cancel`, { reason: 'test' })).status).toBe(404);
  });

  it.each([
    ['residents', [], 'aal2'],
    ['crew', ['crew'], 'aal2'],
    ['hospital partners', ['hospital'], 'aal2'],
    ['staff without TOTP', ['operations'], 'aal1'],
  ])('%s are refused', async (_who, roles, aal) => {
    const s = await setup();
    expect((await (await s.as(OPS, roles, aal)).get('/v1/desk/sos')).status).toBe(403);
  });

  it('support can watch but not act', async () => {
    const s = await setup();
    const id = await s.sos();
    const support = await s.as(SUPPORT, ['support']);
    expect((await support.get(`/v1/desk/sos/${id}`)).status).toBe(200);
    expect((await support.post(`/v1/desk/sos/${id}/cancel`, { reason: 'false alarm' })).status).toBe(403);
    expect((await support.post('/v1/desk/sos/test', { siteId: s.green.id })).status).toBe(403);
  });

  it('shows no medical details', async () => {
    const s = await setup();
    const id = await s.sos();
    const body = JSON.stringify(await detail(await s.ops.get(`/v1/desk/sos/${id}`)));
    expect(body).not.toMatch(/allerg|condition|medic|blood/i);
  });
});

describe('acting on an incident', () => {
  it('cancel needs a reason, stops escalation and moves the incident to the recent list', async () => {
    const s = await setup();
    const id = await s.sos();
    expect((await s.desk.post(`/v1/desk/sos/${id}/cancel`, {})).status).toBe(400);
    const res = await s.desk.post(`/v1/desk/sos/${id}/cancel`, { reason: 'Resident pressed by mistake' });
    expect(res.status).toBe(200);
    const d = await detail(res);
    expect(d.state).toBe('cancelled');
    expect(d.timeline.at(-1)).toMatchObject({ to: 'cancelled', by: 'desk', reason: 'Resident pressed by mistake' });
    expect(s.t.escalation.signals).toContainEqual({ incidentId: id, signal: { kind: 'settled', state: 'cancelled' } });
    expect(await list(await s.desk.get('/v1/desk/sos'))).toEqual([]);
    expect((await list(await s.desk.get('/v1/desk/sos?view=recent'))).map((i) => i.id)).toEqual([id]);
  });

  it('shows the crew on the job with their ambulance and company work number, and offers in order', async () => {
    const s = await setup();
    const c = await s.crew(1);
    s.t.dispatch.vehicles.set(c.id, { registration: 'TS 09 EA 1234', equipment: 'als', workPhone: '+919000000001' });
    s.t.desk.crewNames.set(c.id, 'Ravi Kumar');
    const id = await s.sos();
    expect((await c.accept(id))!.status).toBe(200);
    const d = await detail(await s.desk.get(`/v1/desk/sos/${id}`));
    expect(d.crew).toMatchObject({ crewId: c.id, name: 'Ravi Kumar', workPhone: '+919000000001', ambulance: { registration: 'TS 09 EA 1234' }, distanceM: expect.closeTo(1000, -2) });
    expect(d.offers).toEqual([expect.objectContaining({ crewId: c.id, ring: 1, response: 'accepted', crewName: 'Ravi Kumar' })]);
    expect(d.actions).toMatchObject({ reassign: true, offer: false, cancel: true, handOver: false, close: false });
  });

  it('reassign takes the job back, frees it for the next crew at once, offers the chosen crew and restarts dispatch', async () => {
    const s = await setup();
    const first = await s.crew(1);
    const id = await s.sos();
    expect((await first.accept(id))!.status).toBe(200);
    const second = await s.crew(4);
    expect((await s.desk.post(`/v1/desk/sos/${id}/reassign`, { crewId: second.id })).status).toBe(400);

    const res = await s.desk.post(`/v1/desk/sos/${id}/reassign`, { reason: 'Ambulance broke down', crewId: second.id });
    expect(res.status).toBe(200);
    const d = await detail(res);
    expect(d).toMatchObject({ state: 'dispatching', crew: null });
    expect(d.timeline.at(-1)).toMatchObject({ from: 'accepted', to: 'dispatching', by: 'desk', reason: 'Ambulance broke down' });
    expect(s.t.escalation.started).toContain(id);
    // The first crew's job is gone; the chosen crew's phone rings (ring 0 = the desk) and can take it straight away.
    expect(await (await first.field.get('/v1/crew/job')).json()).toBeNull();
    expect(await second.offers()).toEqual([expect.objectContaining({ incidentId: id, ring: 0 })]);
    expect((await second.accept(id))!.status).toBe(200);
    expect((await detail(await s.desk.get(`/v1/desk/sos/${id}`))).crew).toMatchObject({ crewId: second.id });
  });

  it('manual dispatch offers a free crew (again, if they declined before), never a busy or off-duty one', async () => {
    const s = await setup();
    const near = await s.crew(1);
    const id = await s.sos();
    const offer = (await near.offers())[0]!;
    expect((await near.field.post(`/v1/dispatch/offers/${offer.id}/decline`)).status).toBe(204);
    expect((await s.desk.post(`/v1/desk/sos/${id}/offers`, { crewId: near.id })).status).toBe(200);
    const again = await near.offers();
    expect(again).toEqual([expect.objectContaining({ incidentId: id, ring: 0 })]);
    // A new ring gets a new id, so apps that remember answered offers ring again.
    expect(again[0]!.id).not.toBe(offer.id);

    const off = await s.crew(2);
    s.t.dispatch.onDuty.delete(off.id);
    expect((await s.desk.post(`/v1/desk/sos/${id}/offers`, { crewId: off.id })).status).toBe(409);

    // Taken: no more offers.
    expect((await near.accept(id))!.status).toBe(200);
    const late = await s.crew(3);
    expect((await s.desk.post(`/v1/desk/sos/${id}/offers`, { crewId: late.id })).status).toBe(409);
  });

  it('marks handed over with a reason when the crew cannot, then closes without one', async () => {
    const s = await setup();
    const c = await s.crew(1);
    const id = await s.sos();
    await c.accept(id);
    for (const to of ['en_route', 'on_scene', 'transporting']) await c.field.post(`/v1/sos/${id}/status`, { to });
    expect((await s.desk.post(`/v1/desk/sos/${id}/hand-over`, {})).status).toBe(400);
    const handed = await detail(await s.desk.post(`/v1/desk/sos/${id}/hand-over`, { reason: 'Crew phone switched off; ER confirmed by phone' }));
    expect(handed).toMatchObject({ state: 'handed_over', actions: { close: true, closeNeedsReason: false } });
    const closed = await s.desk.post(`/v1/desk/sos/${id}/close`, {});
    expect(closed.status).toBe(200);
    expect((await detail(closed)).timeline.at(-1)).toMatchObject({ to: 'closed', by: 'desk', reason: null });
  });

  it('closing before hand-over needs a reason (treated at home)', async () => {
    const s = await setup();
    const c = await s.crew(1);
    const id = await s.sos();
    await c.accept(id);
    for (const to of ['en_route', 'on_scene']) await c.field.post(`/v1/sos/${id}/status`, { to });
    expect((await s.desk.post(`/v1/desk/sos/${id}/close`, {})).status).toBe(400);
    expect((await s.desk.post(`/v1/desk/sos/${id}/close`, { reason: 'Treated at home' })).status).toBe(200);
  });

  it('illegal moves are refused (cannot hand over a job still looking for a crew)', async () => {
    const s = await setup();
    const id = await s.sos();
    expect((await s.desk.post(`/v1/desk/sos/${id}/hand-over`, { reason: 'x' })).status).toBe(409);
  });
});

describe('test SOS (drills)', () => {
  it('raises a drill for the community on the staff member’s own account, offered only to drill crews', async () => {
    const s = await setup();
    const drillCrew = await s.crew(1, { drillParticipant: true });
    const realCrew = await s.crew(0.5);
    const res = await s.desk.post('/v1/desk/sos/test', { siteId: s.green.id });
    expect(res.status).toBe(201);
    const d = await detail(res);
    expect(d).toMatchObject({ isDrill: true, siteId: s.green.id, location: HOME, resident: { userId: DESK } });
    expect(s.t.escalation.started).toContain(d.id);

    await beginDispatch({ sos: s.t.deps.sos, alerts: dispatchAlerts({ dispatch: s.t.deps.dispatch, locator: s.t.locator, sos: s.t.deps.sos }) }, d.id);
    expect((await drillCrew.offers()).map((o) => o.incidentId)).toEqual([d.id]);
    expect(await realCrew.offers()).toEqual([]);
    // A real crew cannot be pulled into a drill by hand either.
    expect((await s.desk.post(`/v1/desk/sos/${d.id}/offers`, { crewId: realCrew.id })).status).toBe(409);
  });

  it('pressing again returns the open drill; a resident’s real SOS is never blocked by it', async () => {
    const s = await setup();
    const a = await detail(await s.desk.post('/v1/desk/sos/test', { siteId: s.green.id }));
    const again = await s.desk.post('/v1/desk/sos/test', { siteId: s.green.id });
    expect(again.status).toBe(200);
    expect((await detail(again)).id).toBe(a.id);
    const real = await s.sos(A);
    expect(real).not.toBe(a.id);
    expect(s.t.sos.incidents.find((i) => i.id === real)).toMatchObject({ isDrill: false, userId: A });
  });

  it('the community desk can only drill its own community', async () => {
    const s = await setup();
    expect((await s.desk.post('/v1/desk/sos/test', { siteId: s.palm.id })).status).toBe(404);
    expect((await (await s.desk.get('/v1/desk/sites')).json())).toEqual({ sites: [{ id: s.green.id, name: 'Green Meadows', city: 'Hyderabad' }] });
    expect(((await (await s.ops.get('/v1/desk/sites')).json()) as { sites: unknown[] }).sites).toHaveLength(2);
  });
});

describe('fleet and live updates', () => {
  it('lists crews with duty, current job and last position', async () => {
    const s = await setup();
    const busy = await s.crew(1);
    const idle = await s.crew(2);
    const id = await s.sos();
    await busy.accept(id);
    const fleet = ((await (await s.desk.get('/v1/desk/fleet')).json()) as { crews: { crewId: string; onDuty: boolean; incidentId: string | null; position: unknown }[] }).crews;
    expect(fleet.find((c) => c.crewId === busy.id)).toMatchObject({ onDuty: true, incidentId: id, position: { lat: expect.closeTo(north(1).lat, 5) } });
    expect(fleet.find((c) => c.crewId === idle.id)).toMatchObject({ onDuty: true, incidentId: null });
  });

  it('a new SOS, its alarms and every change reach the community’s desk channel and operations; never medical details', async () => {
    const s = await setup();
    const id = await s.sos();
    const desk = (t: Ctx) => t.published.filter((p) => p.topic === `desk:${s.green.id}`);
    expect(desk(s.t)).toEqual(
      expect.arrayContaining([
        { topic: `desk:${s.green.id}`, event: 'state', payload: expect.objectContaining({ incidentId: id, state: 'raised' }) },
        { topic: `desk:${s.green.id}`, event: 'state', payload: expect.objectContaining({ incidentId: id, state: 'dispatching' }) },
        { topic: `desk:${s.green.id}`, event: 'alarm', payload: expect.objectContaining({ incidentId: id, why: 'raised' }) },
      ]),
    );
    expect(s.t.published.filter((p) => p.topic === 'desk:all')).toHaveLength(desk(s.t).length);
    expect(s.t.published.some((p) => p.topic === `desk:${s.palm.id}`)).toBe(false);
    expect(JSON.stringify(s.t.published)).not.toMatch(/allerg|condition|medic|blood|Lakshmi/i);
  });
});
