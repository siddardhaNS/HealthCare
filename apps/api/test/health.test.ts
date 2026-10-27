import { describe, expect, it } from 'vitest';
import { purposeMeta } from '@repo/contracts';
import { adherence30, istDate, istSlot } from '../src/modules/health/service';
import { testContext } from './helpers';

const MOM = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const SON = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';
const STRANGER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OPS = '11111111-1111-4111-8111-111111111111';

type Ctx = Awaited<ReturnType<typeof testContext>>;

async function client(t: Ctx, sub: string, extra: Record<string, unknown> = {}) {
  const token = await t.token({ sub, ...extra });
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  return {
    get: (p: string) => t.app.request(p, { headers: h }),
    post: (p: string, b: unknown) => t.app.request(p, { method: 'POST', headers: h, body: JSON.stringify(b) }),
    put: (p: string, b: unknown) => t.app.request(p, { method: 'PUT', headers: h, body: JSON.stringify(b) }),
    del: (p: string) => t.app.request(p, { method: 'DELETE', headers: h }),
  };
}

async function family(t: Ctx) {
  const hid = await t.hh.repo.createHousehold({ homeId: null, city: 'Vijayawada' }, MOM);
  await t.hh.repo.addMember(hid, SON, 'member', 'son');
  await t.hh.repo.saveProfile(MOM, { fullName: 'Lakshmi Rao', language: 'te' });
  return { mom: await client(t, MOM), son: await client(t, SON) };
}

const grant = (t: Ctx, userId: string, purpose: 'manager' | 'proactive_care', scopeKey = '') =>
  t.consentRows.push({ purpose, scopeKey, status: 'granted', noticeVersion: purposeMeta[purpose].noticeVersion, language: 'en', actedBy: userId, userId, createdAt: new Date() });

const base = `/v1/people/${MOM}/health`;

describe('vital readings', () => {
  it('logs a reading with unit and status, and the summary shows the latest per vital', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    const res = await mom.post(`${base}/vitals`, { type: 'bp', value: 145, value2: 88 });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ type: 'bp', unit: 'mmHg', value: 145, value2: 88, status: { key: 'high', level: 'danger' }, enteredByOther: false });

    await mom.post(`${base}/vitals`, { type: 'bp', value: 124, value2: 78, takenAt: new Date(Date.now() - 86_400_000).toISOString() });
    await mom.post(`${base}/vitals`, { type: 'spo2', value: 97 });
    const sum = (await (await mom.get(`${base}/summary`)).json()) as { latest: Record<string, { value: number } | null> };
    expect(sum.latest.bp!.value).toBe(145);
    expect(sum.latest.spo2!.value).toBe(97);
    expect(sum.latest.pulse).toBeNull();
  });

  it.each([
    [{ type: 'bp', value: 120 }, 'needs_diastolic'],
    [{ type: 'spo2', value: 140 }, 'out_of_range'],
    [{ type: 'pulse', value: 70, value2: 3 }, 'unexpected_second_value'],
    [{ type: 'sugar', value: 110, takenAt: new Date(Date.now() + 86_400_000).toISOString() }, 'future'],
  ])('rejects %j (%s)', async (body, code) => {
    const t = await testContext();
    const { mom } = await family(t);
    const res = await mom.post(`${base}/vitals`, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  it('a series returns newest first with the target band; removed readings disappear', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    for (let i = 0; i < 9; i++) await mom.post(`${base}/vitals`, { type: 'sugar', value: 100 + i, takenAt: new Date(Date.now() - i * 3_600_000).toISOString() });
    const s = (await (await mom.get(`${base}/vitals/sugar`)).json()) as { readings: { id: string; value: number }[]; target: unknown };
    expect(s.readings).toHaveLength(7);
    expect(s.readings[0]!.value).toBe(100);
    expect(s.target).toEqual({ low: 80, high: 130 });
    expect((await mom.del(`${base}/vitals/${s.readings[0]!.id}`)).status).toBe(204);
    const after = (await (await mom.get(`${base}/vitals/sugar?limit=90`)).json()) as { readings: unknown[] };
    expect(after.readings).toHaveLength(8);
  });

  it('weight status uses the height in the profile (BMI)', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    await mom.put(`${base}/profile`, { bloodGroup: 'B+', heightCm: 160, dateOfBirth: '1958-03-14', sex: 'female' });
    const w = (await (await mom.post(`${base}/vitals`, { type: 'weight', value: 72 })).json()) as { status: { key: string } };
    expect(w.status.key).toBe('overweight');
    const sum = (await (await mom.get(`${base}/summary`)).json()) as { bmi: number; age: number; profile: { bloodGroup: string } };
    expect(sum.bmi).toBe(28.1);
    expect(sum.age).toBeGreaterThanOrEqual(68);
    expect(sum.profile.bloodGroup).toBe('B+');
  });
});

describe('who can read and write the record', () => {
  it('a household member who is not a manager cannot; a manager can, and the entry is marked as theirs', async () => {
    const t = await testContext();
    const { son } = await family(t);
    expect((await son.get(`${base}/summary`)).status).toBe(403);
    expect((await son.post(`${base}/vitals`, { type: 'pulse', value: 72 })).status).toBe(403);
    grant(t, MOM, 'manager', SON);
    const res = await son.post(`${base}/vitals`, { type: 'pulse', value: 72 });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { enteredByOther: boolean }).enteredByOther).toBe(true);
  });

  it('strangers never can', async () => {
    const t = await testContext();
    await family(t);
    const s = await client(t, STRANGER);
    expect((await s.get(`${base}/summary`)).status).toBe(403);
    expect((await s.post(`${base}/allergies`, { substance: 'Penicillin', severity: 'severe' })).status).toBe(403);
  });
});

describe('conditions, allergies, medicines', () => {
  it('condition notes are encrypted at rest and readable through the API', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    const res = await mom.post(`${base}/conditions`, { name: 'Hypertension', status: 'controlled', notes: 'Started telmisartan in 2021' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { notes: string }).notes).toBe('Started telmisartan in 2021');
    const stored = t.health.conditions[0]!;
    expect(stored.notesEnc).toBeTruthy();
    expect(stored.notesEnc).not.toContain('telmisartan');
  });

  it('allergies and medicines appear in the summary; removing one hides it', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    const a = (await (await mom.post(`${base}/allergies`, { substance: 'Penicillin', severity: 'severe', reaction: 'Rash' })).json()) as { id: string };
    await mom.post(`${base}/medications`, { name: 'Telmisartan', strength: '40 mg', schedule: ['21:00'] });
    let sum = (await (await mom.get(`${base}/summary`)).json()) as { allergies: unknown[]; medications: { name: string; today: { time: string; status: string }[] }[] };
    expect(sum.allergies).toHaveLength(1);
    expect(sum.medications[0]).toMatchObject({ name: 'Telmisartan', today: [{ time: '21:00', status: 'due' }] });
    await mom.del(`${base}/allergies/${a.id}`);
    sum = (await (await mom.get(`${base}/summary`)).json()) as typeof sum;
    expect(sum.allergies).toHaveLength(0);
  });

  it('ticks a dose as taken (today only for scheduled times; not in the future)', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    const med = (await (await mom.post(`${base}/medications`, { name: 'Metformin', schedule: ['08:00', '20:00'] })).json()) as { id: string };
    const today = istDate(new Date());
    const ok = await mom.post(`${base}/medications/${med.id}/doses`, { date: today, time: '08:00', status: 'taken' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { today: { time: string; status: string }[] }).today).toEqual([
      { time: '08:00', status: 'taken' },
      { time: '20:00', status: 'due' },
    ]);
    expect((await mom.post(`${base}/medications/${med.id}/doses`, { date: today, time: '13:00', status: 'taken' })).status).toBe(400);
    const tomorrow = istDate(new Date(Date.now() + 86_400_000));
    expect((await mom.post(`${base}/medications/${med.id}/doses`, { date: tomorrow, time: '08:00', status: 'taken' })).status).toBe(400);
  });
});

describe('30-day adherence', () => {
  const now = istSlot('2026-10-27', '22:00');
  const med = { id: 'm1', name: 'Telmisartan', strength: null, dose: null, frequency: null, schedule: ['21:00'], startDate: '2026-10-18', endDate: null, active: true };

  it('counts only doses already due since the start date', () => {
    // 18 Oct → 27 Oct inclusive = 10 evening doses; 8 taken.
    const taken = ['18', '19', '20', '21', '22', '23', '25', '27'].map((d) => ({ medicationId: 'm1', scheduledAt: istSlot(`2026-10-${d}`, '21:00'), status: 'taken' }));
    expect(adherence30(med, taken, now)).toBe(80);
  });

  it('is null without a schedule, and today’s not-yet-due dose is not counted against the person', () => {
    expect(adherence30({ ...med, schedule: [] }, [], now)).toBeNull();
    const early = istSlot('2026-10-18', '20:00');
    expect(adherence30(med, [], early)).toBeNull();
  });
});

describe('care team view (console)', () => {
  it('needs the person’s proactive_care consent; each view is recorded as a disclosure', async () => {
    const t = await testContext();
    const { mom } = await family(t);
    await mom.post(`${base}/allergies`, { substance: 'Penicillin', severity: 'severe' });
    const ops = await client(t, OPS, { aal: 'aal2', app_roles: ['operations'] });

    const refused = await ops.get(`/v1/residents/${MOM}/health`);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('no_consent');
    expect(t.health.shares).toHaveLength(0);

    grant(t, MOM, 'proactive_care');
    const res = await ops.get(`/v1/residents/${MOM}/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { allergies: { substance: string }[] }).allergies[0]!.substance).toBe('Penicillin');
    expect(t.health.shares).toEqual([{ subjectId: MOM, viewerId: OPS, viewerRole: 'operations', purpose: 'proactive_care', items: ['vitals', 'conditions_allergies', 'medicines'], contextType: 'care_team' }]);
    expect(t.residentViews).toContainEqual({ staffId: OPS, role: 'operations', residentId: MOM });
  });

  it('the community desk can never open it, even with consent', async () => {
    const t = await testContext();
    await family(t);
    grant(t, MOM, 'proactive_care');
    const desk = await client(t, OPS, { aal: 'aal2', app_roles: ['community_desk'] });
    expect((await desk.get(`/v1/residents/${MOM}/health`)).status).toBe(403);
  });
});
