import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  purposeMeta,
  type DeskIncidentDetail,
  type HandoverLinkView,
  type HandoverSummary,
  type PartnerHandoverDetail,
  type PartnerHandovers,
  type ResidentSos,
} from '@repo/contracts';
import { encryptJson } from '../src/lib/crypto';
import { dispatchAlerts } from '../src/modules/dispatch/service';
import { buildRecord, chooseHospital, hashLinkToken, newLinkToken, PREFERRED_SLACK_S } from '../src/modules/handover/policy';
import { beginDispatch } from '../src/modules/sos/escalation-service';
import { emptyPatient } from './fake-handover';
import { testContext } from './helpers';

const OPS = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const ER = '44444444-4444-4444-8444-444444444444';
const OTHER_ER = '55555555-5555-4555-8555-555555555555';
const SUPPORT = '66666666-6666-4666-8666-666666666666';
const A = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const B = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';
const HOME = { lat: 17.44, lng: 78.35 };
const north = (km: number) => ({ lat: HOME.lat + km / 111.2, lng: HOME.lng });

describe('choosing the receiving hospital (⚑4)', () => {
  const h = (id: string, km: number, p: { hasCapacity?: boolean; active?: boolean } = {}) => ({ id, ...north(km), hasCapacity: true, active: true, ...p });

  it('the nearest hospital with capacity', () => {
    expect(chooseHospital(HOME, [h('far', 8), h('near', 2), h('full', 1, { hasCapacity: false }), h('closed', 0.5, { active: false })], null)).toMatchObject({
      hospitalId: 'near',
      preferred: false,
    });
  });

  it('the preferred hospital when it is at most 10 minutes further', () => {
    // 25 km/h × 1.4 road factor: ~2.98 km more straight line ≈ 10 min.
    expect(chooseHospital(HOME, [h('near', 1), h('mine', 3.5)], 'mine')).toMatchObject({ hospitalId: 'mine', preferred: true });
    const tooFar = chooseHospital(HOME, [h('near', 1), h('mine', 5)], 'mine');
    expect(tooFar).toMatchObject({ hospitalId: 'near', preferred: false });
    expect(PREFERRED_SLACK_S).toBe(600);
  });

  it('a full or inactive preferred hospital is skipped; none with capacity → null', () => {
    expect(chooseHospital(HOME, [h('near', 1), h('mine', 1.5, { hasCapacity: false })], 'mine')).toMatchObject({ hospitalId: 'near' });
    expect(chooseHospital(HOME, [h('near', 1), h('mine', 1.5, { active: false })], 'mine')).toMatchObject({ hospitalId: 'near' });
    expect(chooseHospital(HOME, [h('full', 1, { hasCapacity: false })], null)).toBeNull();
  });

  it('link tokens are random and only their hash is kept', () => {
    const a = newLinkToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toBe(hashLinkToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(newLinkToken().token).not.toBe(a.token);
  });
});

describe('what the ER sees', () => {
  const key = randomBytes(32);
  const data = {
    ...emptyPatient(),
    name: 'Lakshmi Rao',
    dateOfBirth: '1956-03-02',
    sex: 'female',
    bloodGroup: 'B+',
    allergies: [{ substance: 'Penicillin', severity: 'severe', reaction: 'Rash' }],
    conditions: [{ name: 'Type 2 diabetes', status: 'active' }],
    medications: [
      { name: 'Metformin', strength: '500 mg', dose: '1 tablet', frequency: 'twice a day', active: true },
      { name: 'Old', strength: null, dose: null, frequency: null, active: false },
    ],
    readings: [{ type: 'bp', value: 150, value2: 95, unit: 'mmHg', takenAt: new Date('2026-10-29T08:00:00Z') }],
    contacts: [{ name: 'Ravi', relation: 'son', phone: '+919900000001' }],
    insurance: [{ insurer: 'Star Health', policyNumberEnc: encryptJson(key, 'P-123'), memberIdEnc: null, validUntil: '2027-03-31' }],
  };

  it('with emergency sharing off: the name and blood group only (plus the crew’s notes)', () => {
    const r = buildRecord(data, ['blood_group'], key, encryptJson(key, 'Oxygen given'), new Date('2026-10-30T00:00:00Z'));
    expect(r).toEqual({ items: ['blood_group'], patient: { name: 'Lakshmi Rao', age: null, sex: null }, bloodGroup: 'B+', firstAidNotes: 'Oxygen given' });
  });

  it('with emergency sharing on: every item, active medicines only, insurance decrypted', () => {
    const r = buildRecord(
      data,
      ['blood_group', 'allergies', 'conditions', 'medicines', 'last_vitals', 'emergency_contacts', 'insurance'],
      key,
      null,
      new Date('2026-10-30T00:00:00Z'),
    );
    expect(r.patient).toEqual({ name: 'Lakshmi Rao', age: 70, sex: 'female' });
    expect(r.allergies).toEqual([{ substance: 'Penicillin', severity: 'severe', reaction: 'Rash' }]);
    expect(r.medicines!.map((m) => m.name)).toEqual(['Metformin']);
    expect(r.lastVitals).toEqual([{ type: 'bp', value: 150, value2: 95, unit: 'mmHg', takenAt: '2026-10-29T08:00:00.000Z' }]);
    expect(r.emergencyContacts).toEqual([{ name: 'Ravi', relation: 'son', phone: '+919900000001' }]);
    expect(r.insurance).toEqual([{ insurer: 'Star Health', policyNumber: 'P-123', memberId: null, validUntil: '2027-03-31' }]);
  });
});

/** Lakshmi (A) in Green Meadows; two hospitals north of her home; ER staff of the nearer one. */
async function setup() {
  const t = await testContext();
  const green = t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
  await t.hh.repo.createHousehold({ homeId: (await t.hh.repo.findHome(green.id, 'B', '1204'))!.id, city: 'Hyderabad' }, A);
  await t.hh.repo.saveProfile(A, { fullName: 'Lakshmi Rao', language: 'te' });
  t.deskScopes.set(DESK, [green.id]);
  t.desk.sites.set(green.id, { name: 'Green Meadows', city: 'Hyderabad', centre: HOME });
  const near = t.handovers.addHospital({ name: 'Care Hospital', ...north(2) });
  const far = t.handovers.addHospital({ name: 'City Hospital', ...north(9) });
  t.handovers.partners.set(ER, [near.id]);
  t.handovers.partners.set(OTHER_ER, [far.id]);
  t.handovers.patients.set(A, {
    ...emptyPatient(),
    name: 'Lakshmi Rao',
    bloodGroup: 'B+',
    dateOfBirth: '1956-03-02',
    sex: 'female',
    allergies: [{ substance: 'Penicillin', severity: 'severe', reaction: null }],
  });

  const as = async (sub: string, roles: string[], aal = 'aal2') => {
    const h = { authorization: `Bearer ${await t.token({ sub, aal, app_roles: roles })}`, 'content-type': 'application/json' };
    return {
      get: (p: string) => t.app.request(p, { headers: h }),
      post: (p: string, b: unknown = {}) => t.app.request(p, { method: 'POST', headers: h, body: JSON.stringify(b) }),
      put: (p: string, b: unknown) => t.app.request(p, { method: 'PUT', headers: h, body: JSON.stringify(b) }),
      patch: (p: string, b: unknown) => t.app.request(p, { method: 'PATCH', headers: h, body: JSON.stringify(b) }),
    };
  };
  const resident = await as(A, []);
  const share = (status: 'granted' | 'withdrawn') =>
    resident.post('/v1/consents', {
      purpose: 'emergency_share',
      status,
      scopeKey: '',
      noticeVersion: purposeMeta.emergency_share.noticeVersion,
      language: 'en',
    });
  const sos = async () => {
    const res = await resident.post('/v1/sos', { idempotencyKey: randomUUID(), location: HOME });
    const { id } = (await res.json()) as { id: string };
    await beginDispatch(
      { sos: t.deps.sos, alerts: dispatchAlerts({ dispatch: t.deps.dispatch, locator: t.locator, sos: t.deps.sos, realtime: t.deps.realtime }) },
      id,
    );
    return id;
  };
  const crew = async (p: { drillParticipant?: boolean } = {}) => {
    const userId = randomUUID();
    const c = t.dispatch.addCrew({ userId, ...p });
    await t.locator.set(c.id, north(1));
    const field = await as(userId, ['crew']);
    const offerFor = async (incidentId: string) =>
      ((await (await field.get('/v1/crew/offers')).json()) as { id: string; incidentId: string }[]).find((x) => x.incidentId === incidentId);
    const accept = async (incidentId: string) => {
      // Crews that came on duty after dispatch began get the job from the desk.
      if (!(await offerFor(incidentId))) await (await as(OPS, ['operations'])).post(`/v1/desk/sos/${incidentId}/offers`, { crewId: c.id });
      const o = (await offerFor(incidentId))!;
      return field.post(`/v1/dispatch/offers/${o.id}/accept`);
    };
    return { ...c, field, accept };
  };
  const er = await as(ER, ['hospital']);
  const otherEr = await as(OTHER_ER, ['hospital']);
  const ops = await as(OPS, ['operations']);
  const desk = await as(DESK, ['community_desk']);
  const linkOf = (incidentId: string) =>
    t.links
      .filter((l) => l.incidentId === incidentId)
      .at(-1)!
      .url.split('/handover/')[1]!;
  const openLink = (token: string) => t.app.request(`/v1/handover-links/${token}`);
  return { t, green, near, far, as, resident, share, sos, crew, er, otherEr, ops, desk, linkOf, openLink };
}

describe('hospital handover on accept', () => {
  it('opens to the nearest hospital, with everything the person consented to', async () => {
    const s = await setup();
    await s.share('granted');
    const id = await s.sos();
    const c = await s.crew();
    expect((await c.accept(id)).status).toBe(200);

    const h = s.t.handovers.rows[0]!;
    expect(h).toMatchObject({ incidentId: id, hospitalId: s.near.id, chosenBy: 'auto', preferred: false });
    expect(h.items).toEqual(['blood_group', 'allergies', 'conditions', 'medicines', 'last_vitals', 'emergency_contacts', 'insurance']);
    expect(s.t.links).toHaveLength(1);
    expect(s.t.links[0]!.url).toMatch(/^https:\/\/console\.example\.test\/handover\/[A-Za-z0-9_-]{43}$/);
    // Only the hash is stored.
    expect(h.tokenHash).toBe(hashLinkToken(s.linkOf(id)));

    // The crew's job, the resident's screen and the desk show where and which items, never contents.
    const job = (await (await c.field.get('/v1/crew/job')).json()) as { handover: HandoverSummary };
    expect(job.handover).toMatchObject({ hospital: { name: 'Care Hospital' }, items: h.items, confirmedAt: null });
    const mine = (await (await s.resident.get(`/v1/sos/${id}`)).json()) as ResidentSos;
    expect(mine.handover).toMatchObject({ hospital: { name: 'Care Hospital' } });
    const desk = (await (await s.desk.get(`/v1/desk/sos/${id}`)).json()) as DeskIncidentDetail;
    expect(desk.handover).toMatchObject({ hospital: { name: 'Care Hospital', erPhone: '+914012345678' } });
    expect(desk.hospitalsNearby.map((x) => x.name)).toEqual(['Care Hospital', 'City Hospital']);
    expect(JSON.stringify(desk)).not.toMatch(/Penicillin|B\+/);
  });

  it('with emergency sharing off: the blood group only', async () => {
    const s = await setup();
    await s.share('granted');
    await s.share('withdrawn');
    const id = await s.sos();
    await (await s.crew()).accept(id);
    expect(s.t.handovers.rows[0]!.items).toEqual(['blood_group']);
    const view = (await (await s.openLink(s.linkOf(id))).json()) as HandoverLinkView;
    expect(view.record).toEqual({ items: ['blood_group'], patient: { name: 'Lakshmi Rao', age: null, sex: null }, bloodGroup: 'B+', firstAidNotes: null });
  });

  it('the preferred hospital, set by the person, wins within 10 minutes', async () => {
    const s = await setup();
    const mine = s.t.handovers.addHospital({ name: 'My Hospital', ...north(4.5) });
    const choices = await s.resident.put(`/v1/people/${A}/preferred-hospital`, { hospitalId: mine.id });
    expect(choices.status).toBe(200);
    expect(await choices.json()).toMatchObject({ preferredId: mine.id });
    // Nobody else can set it.
    expect((await (await s.as(B, [])).put(`/v1/people/${A}/preferred-hospital`, { hospitalId: s.far.id })).status).toBe(403);
    const id = await s.sos();
    await (await s.crew()).accept(id);
    expect(s.t.handovers.rows[0]).toMatchObject({ hospitalId: mine.id, preferred: true });
  });

  it('no hospital with capacity: no handover, the desk is alarmed; the accept still succeeds', async () => {
    const s = await setup();
    s.t.handovers.hospitals.forEach((h) => (h.hasCapacity = false));
    const id = await s.sos();
    expect((await (await s.crew()).accept(id)).status).toBe(200);
    expect(s.t.handovers.rows).toHaveLength(0);
    expect(s.t.published.some((p) => p.event === 'alarm' && JSON.stringify(p).includes('no_hospital'))).toBe(true);
    // The desk chooses one.
    const res = await s.desk.post(`/v1/desk/sos/${id}/hospital`, { hospitalId: s.far.id, reason: 'Care Hospital ER full' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as DeskIncidentDetail).handover).toMatchObject({
      hospital: { name: 'City Hospital' },
      chosenBy: 'desk',
      reason: 'Care Hospital ER full',
    });
  });

  it('drills never reach a hospital', async () => {
    const s = await setup();
    const drill = (await (await s.desk.post('/v1/desk/sos/test', { siteId: s.green.id })).json()) as { id: string };
    await beginDispatch({ sos: s.t.deps.sos, alerts: dispatchAlerts({ dispatch: s.t.deps.dispatch, locator: s.t.locator, sos: s.t.deps.sos }) }, drill.id);
    const c = await s.crew({ drillParticipant: true });
    expect((await c.accept(drill.id)).status).toBe(200);
    expect(s.t.handovers.rows).toHaveLength(0);
    expect(s.t.links).toHaveLength(0);
    expect((await s.desk.post(`/v1/desk/sos/${drill.id}/hospital`, { hospitalId: s.far.id, reason: 'x' })).status).toBe(409);
  });
});

describe('the partner portal', () => {
  it('lists the hospital’s incoming patients with arrival ETA; other hospitals see nothing', async () => {
    const s = await setup();
    const id = await s.sos();
    await (await s.crew()).accept(id);
    const list = (await (await s.er.get('/v1/partner/handovers')).json()) as PartnerHandovers;
    expect(list.hospital).toMatchObject({ name: 'Care Hospital', hasCapacity: true });
    expect(list.handovers).toHaveLength(1);
    expect(list.handovers[0]).toMatchObject({
      id,
      ref: expect.stringMatching(/^SOS-/),
      state: 'accepted',
      expired: false,
      confirmedAt: null,
      arrivalEtaS: expect.any(Number),
    });
    expect(((await (await s.otherEr.get('/v1/partner/handovers')).json()) as PartnerHandovers).handovers).toEqual([]);
    expect((await s.otherEr.get(`/v1/partner/handovers/${id}`)).status).toBe(404);
    expect((await s.otherEr.post(`/v1/partner/handovers/${id}/confirm`)).status).toBe(404);
  });

  it('opening the record is logged in record_shares; confirm works once', async () => {
    const s = await setup();
    await s.share('granted');
    const id = await s.sos();
    const c = await s.crew();
    await c.accept(id);
    expect((await c.field.post(`/v1/sos/${id}/first-aid-notes`, { notes: 'Aspirin 300 mg at 10:42' })).status).toBe(204);

    const detail = (await (await s.er.get(`/v1/partner/handovers/${id}`)).json()) as PartnerHandoverDetail;
    expect(detail.record).toMatchObject({
      patient: { name: 'Lakshmi Rao', age: expect.any(Number) },
      bloodGroup: 'B+',
      allergies: [{ substance: 'Penicillin' }],
      firstAidNotes: 'Aspirin 300 mg at 10:42',
    });
    expect(s.t.handovers.shares).toEqual([{ subjectId: A, viewerId: ER, viewerRole: 'hospital', items: detail.items, incidentId: id }]);

    const first = await s.er.post(`/v1/partner/handovers/${id}/confirm`);
    expect(first.status).toBe(200);
    const at = ((await first.json()) as { confirmedAt: string }).confirmedAt;
    expect(at).toBeTruthy();
    const again = (await (await s.er.post(`/v1/partner/handovers/${id}/confirm`)).json()) as { confirmedAt: string };
    expect(again.confirmedAt).toBe(at);
    expect(s.t.handovers.audit.filter((a) => a.action === 'sos_handover_confirmed')).toHaveLength(1);
    // The desk sees the receipt.
    expect(((await (await s.desk.get(`/v1/desk/sos/${id}`)).json()) as DeskIncidentDetail).handover?.confirmedAt).toBe(at);
  });

  it('only hospital staff with two-factor, linked to a hospital', async () => {
    const s = await setup();
    expect((await (await s.as(ER, ['hospital'], 'aal1')).get('/v1/partner/handovers')).status).toBe(403);
    expect((await s.desk.get('/v1/partner/handovers')).status).toBe(403);
    const unlinked = await s.as(randomUUID(), ['hospital']);
    expect((await unlinked.get('/v1/partner/handovers')).status).toBe(403);
  });

  it('ER full: the hospital is skipped for the next patient', async () => {
    const s = await setup();
    const res = await s.er.put('/v1/partner/capacity', { hasCapacity: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Care Hospital', hasCapacity: false, capacityUpdatedAt: expect.any(String) });
    const id = await s.sos();
    await (await s.crew()).accept(id);
    expect(s.t.handovers.rows[0]).toMatchObject({ incidentId: id, hospitalId: s.far.id });
  });
});

describe('the signed link', () => {
  it('works without sign-in, is logged each time, and is never cached', async () => {
    const s = await setup();
    const id = await s.sos();
    await (await s.crew()).accept(id);
    const res = await s.openLink(s.linkOf(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ hospital: 'Care Hospital', isDrill: false, record: { bloodGroup: 'B+' } });
    expect(s.t.handovers.shares).toEqual([expect.objectContaining({ viewerId: null, viewerRole: 'hospital_link', incidentId: id })]);
  });

  it('unknown, malformed, expired and cancelled links all look the same', async () => {
    const s = await setup();
    const id = await s.sos();
    await (await s.crew()).accept(id);
    const token = s.linkOf(id);
    expect((await s.openLink(newLinkToken().token)).status).toBe(404);
    expect((await s.openLink('short')).status).toBe(404);
    s.t.handovers.rows[0]!.expiresAt = new Date(Date.now() - 1000);
    expect((await s.openLink(token)).status).toBe(404);
    // The portal keeps the entry but no longer shows the record.
    expect(((await (await s.er.get(`/v1/partner/handovers/${id}`)).json()) as PartnerHandoverDetail).record).toBeNull();
    s.t.handovers.rows[0]!.expiresAt = new Date(Date.now() + 60_000);
    expect((await s.openLink(token)).status).toBe(200);
    await s.desk.post(`/v1/desk/sos/${id}/cancel`, { reason: 'False alarm' });
    expect((await s.openLink(token)).status).toBe(404);
  });

  it('is rate limited per client', async () => {
    const s = await setup();
    const token = newLinkToken().token;
    let last = 0;
    for (let n = 0; n < 31; n++) last = (await s.t.app.request(`/v1/handover-links/${token}`, { headers: { 'x-forwarded-for': '203.0.113.9' } })).status;
    expect(last).toBe(429);
  });
});

describe('changing the hospital', () => {
  it('the crew redirects with a reason: a new link, the old one stops working, confirmation cleared', async () => {
    const s = await setup();
    const id = await s.sos();
    const c = await s.crew();
    await c.accept(id);
    const old = s.linkOf(id);
    const choices = (await (await c.field.get(`/v1/sos/${id}/hospitals`)).json()) as { hospitals: { id: string; name: string }[] };
    expect(choices.hospitals.map((h) => h.name)).toEqual(['Care Hospital', 'City Hospital']);

    expect((await c.field.put(`/v1/sos/${id}/hospital`, { hospitalId: s.far.id, reason: '' })).status).toBe(400);
    const res = await c.field.put(`/v1/sos/${id}/hospital`, { hospitalId: s.far.id, reason: 'Needs cardiac cath lab' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hospital: { name: 'City Hospital' }, chosenBy: 'crew', reason: 'Needs cardiac cath lab', confirmedAt: null });
    expect((await s.openLink(old)).status).toBe(404);
    expect((await s.openLink(s.linkOf(id))).status).toBe(200);
    expect(s.t.handovers.audit.find((a) => a.action === 'sos_handover_redirected')?.metadata).toMatchObject({
      hospital_id: s.far.id,
      from_hospital_id: s.near.id,
      chosen_by: 'crew',
    });
    // The first hospital no longer sees the patient; the second does.
    expect(((await (await s.er.get('/v1/partner/handovers')).json()) as PartnerHandovers).handovers).toEqual([]);
    expect(((await (await s.otherEr.get('/v1/partner/handovers')).json()) as PartnerHandovers).handovers).toHaveLength(1);
  });

  it('only the assigned crew, and not after the job; support cannot', async () => {
    const s = await setup();
    const id = await s.sos();
    const c = await s.crew();
    await c.accept(id);
    const stranger = await s.crew();
    expect((await stranger.field.put(`/v1/sos/${id}/hospital`, { hospitalId: s.far.id, reason: 'x' })).status).toBe(404);
    expect((await (await s.as(SUPPORT, ['support'])).post(`/v1/desk/sos/${id}/hospital`, { hospitalId: s.far.id, reason: 'x' })).status).toBe(403);
    for (const to of ['en_route', 'on_scene', 'transporting', 'handed_over']) await c.field.post(`/v1/sos/${id}/status`, { to });
    expect((await c.field.put(`/v1/sos/${id}/hospital`, { hospitalId: s.far.id, reason: 'x' })).status).toBe(409);
  });
});

describe('managing network hospitals', () => {
  it('super admin and operations add and edit; others cannot', async () => {
    const s = await setup();
    const add = await s.ops.post('/v1/hospitals', { name: 'Apollo', city: 'Hyderabad', location: north(3), erPhone: '+914023607777' });
    expect(add.status).toBe(201);
    const created = (await add.json()) as { id: string };
    expect((await s.ops.post('/v1/hospitals', { name: 'Bad', location: north(3), erPhone: '040-1234' })).status).toBe(400);
    const edit = await s.ops.patch(`/v1/hospitals/${created.id}`, { active: false });
    expect(await edit.json()).toMatchObject({ active: false });
    expect((await s.ops.patch(`/v1/hospitals/${randomUUID()}`, { active: false })).status).toBe(404);
    expect(((await (await s.ops.get('/v1/hospitals')).json()) as { hospitals: unknown[] }).hospitals).toHaveLength(3);
    expect((await s.desk.get('/v1/hospitals')).status).toBe(403);
    expect((await s.er.post('/v1/hospitals', { name: 'X', location: north(3), erPhone: '+914023607777' })).status).toBe(403);
    // Inactive hospitals are not offered to residents.
    const choices = (await (await s.resident.get(`/v1/people/${A}/preferred-hospital`)).json()) as { hospitals: { name: string }[] };
    expect(choices.hospitals.map((h) => h.name)).not.toContain('Apollo');
  });
});
