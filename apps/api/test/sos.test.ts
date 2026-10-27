import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { purposeMeta } from '@repo/contracts';
import { testContext } from './helpers';

const MOM = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const SON = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';
const STRANGER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

type Ctx = Awaited<ReturnType<typeof testContext>>;

async function client(t: Ctx, sub: string) {
  const h = { authorization: `Bearer ${await t.token({ sub })}`, 'content-type': 'application/json' };
  return {
    get: (p: string) => t.app.request(p, { headers: h }),
    post: (p: string, b: unknown) => t.app.request(p, { method: 'POST', headers: h, body: JSON.stringify(b) }),
  };
}

const press = (key = randomUUID()) => ({ idempotencyKey: key, location: { lat: 17.4401, lng: 78.3489, accuracyM: 12 } });

describe('raising an SOS', () => {
  it('creates the incident with location, default thresholds and a first timeline event', async () => {
    const t = await testContext();
    const mom = await client(t, MOM);
    const res = await mom.post('/v1/sos', press());
    expect(res.status).toBe(201);
    const sos = (await res.json()) as { state: string; location: { lat: number }; widenAfterS: number; escalateAfterS: number; isDrill: boolean; timeline: { to: string; by: string }[] };
    expect(sos).toMatchObject({ state: 'raised', isDrill: false, widenAfterS: 30, escalateAfterS: 90, location: { lat: 17.4401 } });
    expect(sos.timeline).toEqual([expect.objectContaining({ to: 'raised', by: 'resident' })]);
    expect(t.sos.audit).toEqual([expect.objectContaining({ action: 'sos_raised' })]);
  });

  it('a retry with the same key never creates a second incident', async () => {
    const t = await testContext();
    const mom = await client(t, MOM);
    const key = randomUUID();
    const a = (await (await mom.post('/v1/sos', press(key))).json()) as { id: string };
    const again = await mom.post('/v1/sos', press(key));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(a.id);
    expect(t.sos.incidents).toHaveLength(1);
  });

  it('a second press with a new key returns the open incident', async () => {
    const t = await testContext();
    const mom = await client(t, MOM);
    const a = (await (await mom.post('/v1/sos', press())).json()) as { id: string };
    const b = await mom.post('/v1/sos', press());
    expect(b.status).toBe(200);
    expect(((await b.json()) as { id: string }).id).toBe(a.id);
    expect(t.sos.incidents).toHaveLength(1);
  });

  it('works without a location (never blocked on GPS)', async () => {
    const t = await testContext();
    const res = await (await client(t, MOM)).post('/v1/sos', { idempotencyKey: randomUUID() });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { location: unknown }).location).toBeNull();
  });

  it('uses the community’s own thresholds', async () => {
    const t = await testContext();
    const site = t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
    await t.hh.repo.createHousehold({ homeId: (await t.hh.repo.findHome(site.id, 'B', '1204'))!.id, city: 'Hyderabad' }, MOM);
    t.sos.settings.set(site.id, { widenAfterS: 20, escalateAfterS: 75 });
    const sos = (await (await (await client(t, MOM)).post('/v1/sos', press())).json()) as { widenAfterS: number; escalateAfterS: number };
    expect(sos).toMatchObject({ widenAfterS: 20, escalateAfterS: 75 });
  });

  it('rejects a location outside India and a missing key', async () => {
    const t = await testContext();
    const mom = await client(t, MOM);
    expect((await mom.post('/v1/sos', { idempotencyKey: randomUUID(), location: { lat: 51.5, lng: -0.12 } })).status).toBe(400);
    expect((await mom.post('/v1/sos', {})).status).toBe(400);
  });
});

describe('viewing and cancelling', () => {
  it('the app finds the open SOS on launch; none after cancelling', async () => {
    const t = await testContext();
    const mom = await client(t, MOM);
    expect(await (await mom.get('/v1/sos/current')).json()).toBeNull();
    const { id } = (await (await mom.post('/v1/sos', press())).json()) as { id: string };
    expect(((await (await mom.get('/v1/sos/current')).json()) as { id: string }).id).toBe(id);
    const cancelled = await mom.post(`/v1/sos/${id}/cancel`, {});
    expect(cancelled.status).toBe(200);
    const body = (await cancelled.json()) as { state: string; timeline: { to: string }[] };
    expect(body.state).toBe('cancelled');
    expect(body.timeline.map((e) => e.to)).toEqual(['raised', 'cancelled']);
    expect(await (await mom.get('/v1/sos/current')).json()).toBeNull();
  });

  it('cannot cancel twice', async () => {
    const t = await testContext();
    const mom = await client(t, MOM);
    const { id } = (await (await mom.post('/v1/sos', press())).json()) as { id: string };
    await mom.post(`/v1/sos/${id}/cancel`, {});
    const again = await mom.post(`/v1/sos/${id}/cancel`, {});
    expect(again.status).toBe(409);
  });

  it('a resident cannot cancel once the ambulance is on its way', async () => {
    const t = await testContext();
    const mom = await client(t, MOM);
    const { id } = (await (await mom.post('/v1/sos', press())).json()) as { id: string };
    t.sos.incidents.find((i) => i.id === id)!.state = 'en_route';
    const res = await mom.post(`/v1/sos/${id}/cancel`, {});
    expect(res.status).toBe(403);
  });

  it('a manager can see and cancel; strangers see nothing', async () => {
    const t = await testContext();
    const hid = await t.hh.repo.createHousehold({ homeId: null, city: 'Vijayawada' }, MOM);
    await t.hh.repo.addMember(hid, SON, 'member', 'son');
    const { id } = (await (await (await client(t, MOM)).post('/v1/sos', press())).json()) as { id: string };

    const stranger = await client(t, STRANGER);
    expect((await stranger.get(`/v1/sos/${id}`)).status).toBe(404);
    expect((await stranger.post(`/v1/sos/${id}/cancel`, {})).status).toBe(404);

    const son = await client(t, SON);
    expect((await son.get(`/v1/sos/${id}`)).status).toBe(404);
    t.consentRows.push({ purpose: 'manager', scopeKey: SON, status: 'granted', noticeVersion: purposeMeta.manager.noticeVersion, language: 'en', actedBy: MOM, userId: MOM, createdAt: new Date() });
    expect((await son.get(`/v1/sos/${id}`)).status).toBe(200);
    expect((await son.post(`/v1/sos/${id}/cancel`, {})).status).toBe(200);
  });
});
