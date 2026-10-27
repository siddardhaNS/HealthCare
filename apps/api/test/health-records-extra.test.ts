import { describe, expect, it } from 'vitest';
import { purposeMeta } from '@repo/contracts';
import { istDate } from '../src/modules/health/service';
import { testContext } from './helpers';

const MOM = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const SON = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';
const OPS = '11111111-1111-4111-8111-111111111111';
const DAY = 86_400_000;
const base = `/v1/people/${MOM}/health`;

type Ctx = Awaited<ReturnType<typeof testContext>>;

async function client(t: Ctx, sub: string, extra: Record<string, unknown> = {}) {
  const h = { authorization: `Bearer ${await t.token({ sub, ...extra })}`, 'content-type': 'application/json' };
  return {
    get: (p: string) => t.app.request(p, { headers: h }),
    post: (p: string, b: unknown) => t.app.request(p, { method: 'POST', headers: h, body: JSON.stringify(b) }),
    del: (p: string) => t.app.request(p, { method: 'DELETE', headers: h }),
  };
}

async function setup() {
  const t = await testContext();
  const hid = await t.hh.repo.createHousehold({ homeId: null, city: 'Vijayawada' }, MOM);
  await t.hh.repo.addMember(hid, SON, 'member', 'son');
  return { t, mom: await client(t, MOM), son: await client(t, SON) };
}

describe('vaccinations', () => {
  it('records vaccinations and flags doses due within 30 days or overdue', async () => {
    const { mom } = await setup();
    await mom.post(`${base}/vaccinations`, { name: 'Influenza', doseLabel: '2026', givenOn: '2025-10-20', nextDue: istDate(new Date(Date.now() + 10 * DAY)) });
    await mom.post(`${base}/vaccinations`, { name: 'Tetanus', givenOn: '2022-05-01', nextDue: '2032-05-01' });
    await mom.post(`${base}/vaccinations`, { name: 'Pneumococcal', nextDue: istDate(new Date(Date.now() - 5 * DAY)) });
    const list = (await (await mom.get(`${base}/vaccinations`)).json()) as { vaccinations: { name: string; dueSoon: boolean }[] };
    expect(Object.fromEntries(list.vaccinations.map((v) => [v.name, v.dueSoon]))).toEqual({ Influenza: true, Tetanus: false, Pneumococcal: true });
  });

  it('refuses a vaccination dated in the future', async () => {
    const { mom } = await setup();
    const res = await mom.post(`${base}/vaccinations`, { name: 'Influenza', givenOn: istDate(new Date(Date.now() + 3 * DAY)) });
    expect(res.status).toBe(400);
  });
});

describe('insurance', () => {
  it('stores policy and member numbers encrypted and returns them to the person', async () => {
    const { t, mom } = await setup();
    const res = await mom.post(`${base}/insurance`, { insurer: 'Star Health', policyNumber: 'P/141100/01/2026/004512', memberId: 'SH-88213', validUntil: '2027-03-31' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ insurer: 'Star Health', policyNumber: 'P/141100/01/2026/004512', memberId: 'SH-88213', expired: false, hasCard: false });
    const stored = t.health.insurance[0]!;
    expect(stored.policyNumberEnc).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain('004512');
    expect(JSON.stringify(stored)).not.toContain('SH-88213');
  });

  it('marks an expired policy', async () => {
    const { mom } = await setup();
    await mom.post(`${base}/insurance`, { insurer: 'Old Insurer', validUntil: '2024-01-31' });
    const list = (await (await mom.get(`${base}/insurance`)).json()) as { policies: { expired: boolean }[] };
    expect(list.policies[0]!.expired).toBe(true);
  });

  it('is not part of the care team view, even with consent', async () => {
    const { t, mom } = await setup();
    await mom.post(`${base}/insurance`, { insurer: 'Star Health', policyNumber: 'P-1' });
    t.consentRows.push({ purpose: 'proactive_care', scopeKey: '', status: 'granted', noticeVersion: purposeMeta.proactive_care.noticeVersion, language: 'en', actedBy: MOM, userId: MOM, createdAt: new Date() });
    const ops = await client(t, OPS, { aal: 'aal2', app_roles: ['operations'] });
    const body = await (await ops.get(`/v1/residents/${MOM}/health`)).text();
    expect(body).not.toContain('Star Health');
    expect(body).not.toContain('P-1');
  });
});

describe('devices', () => {
  it('adds manual and phone health-app devices; Bluetooth is not accepted yet', async () => {
    const { mom } = await setup();
    expect((await mom.post(`${base}/devices`, { kind: 'bp_monitor', name: 'Omron HEM-7120', connection: 'manual' })).status).toBe(201);
    expect((await mom.post(`${base}/devices`, { kind: 'phone', name: 'Health Connect', connection: 'health_connect' })).status).toBe(201);
    expect((await mom.post(`${base}/devices`, { kind: 'glucometer', name: 'Accu-Chek', connection: 'bluetooth' })).status).toBe(400);
    const list = (await (await mom.get(`${base}/devices`)).json()) as { devices: { id: string; connection: string }[] };
    expect(list.devices.map((d) => d.connection)).toEqual(['manual', 'health_connect']);
    expect((await mom.del(`${base}/devices/${list.devices[0]!.id}`)).status).toBe(204);
    expect(((await (await mom.get(`${base}/devices`)).json()) as { devices: unknown[] }).devices).toHaveLength(1);
  });
});

describe('access', () => {
  it('a household member needs manager consent for all three', async () => {
    const { t, son } = await setup();
    for (const p of ['vaccinations', 'insurance', 'devices']) expect((await son.get(`${base}/${p}`)).status).toBe(403);
    t.consentRows.push({ purpose: 'manager', scopeKey: SON, status: 'granted', noticeVersion: purposeMeta.manager.noticeVersion, language: 'en', actedBy: MOM, userId: MOM, createdAt: new Date() });
    for (const p of ['vaccinations', 'insurance', 'devices']) expect((await son.get(`${base}/${p}`)).status).toBe(200);
  });
});
