import { describe, expect, it } from 'vitest';
import { purposeMeta } from '@repo/contracts';
import { testContext } from './helpers';

const OPS = '11111111-1111-4111-8111-111111111111';
const DESK = '22222222-2222-4222-8222-222222222222';
const A = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const B = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';

type Ctx = Awaited<ReturnType<typeof testContext>>;

async function setup() {
  const t = await testContext();
  const green = t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
  const palm = t.hh.addSite({ name: 'Palm Villas', kind: 'gated', city: 'Hyderabad', joinCode: 'PALM777', homes: [{ tower: null, number: '42' }] });
  const ha = await t.hh.repo.createHousehold({ homeId: (await t.hh.repo.findHome(green.id, 'B', '1204'))!.id, city: 'Hyderabad' }, A);
  await t.hh.repo.createHousehold({ homeId: (await t.hh.repo.findHome(palm.id, null, '42'))!.id, city: 'Hyderabad' }, B);
  await t.hh.repo.saveProfile(A, { fullName: 'Lakshmi Rao', language: 'te' });
  await t.hh.repo.saveProfile(B, { fullName: 'Venkat Reddy', language: 'en' });
  t.deskScopes.set(DESK, [green.id]);
  return { t, ha };
}

async function get(t: Ctx, staff: string, roles: string[], path: string, aal = 'aal2') {
  const token = await t.token({ sub: staff, aal, app_roles: roles });
  return t.app.request(path, { headers: { authorization: `Bearer ${token}` } });
}

describe('residents directory', () => {
  it('operations staff see every resident, with phone numbers masked', async () => {
    const { t } = await setup();
    const body = (await (await get(t, OPS, ['operations'], '/v1/residents')).json()) as { residents: { fullName: string; phone: string }[] };
    expect(body.residents.map((r) => r.fullName).sort()).toEqual(['Lakshmi Rao', 'Venkat Reddy']);
    expect(body.residents.every((r) => r.phone === '+91 ••••• 3210')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('9876543210');
  });

  it('the community desk sees only its own community', async () => {
    const { t } = await setup();
    const body = (await (await get(t, DESK, ['community_desk'], '/v1/residents')).json()) as { residents: { fullName: string; community: string }[] };
    expect(body.residents).toEqual([expect.objectContaining({ fullName: 'Lakshmi Rao', community: 'Green Meadows' })]);
  });

  it('a desk user without an assigned community sees nobody', async () => {
    const { t } = await setup();
    const body = (await (await get(t, '33333333-3333-4333-8333-333333333333', ['community_desk'], '/v1/residents')).json()) as { residents: unknown[] };
    expect(body.residents).toEqual([]);
  });

  it('searches by name, number or community', async () => {
    const { t } = await setup();
    const body = (await (await get(t, OPS, ['operations'], '/v1/residents?q=palm')).json()) as { residents: { fullName: string }[] };
    expect(body.residents.map((r) => r.fullName)).toEqual(['Venkat Reddy']);
  });

  it.each([
    ['partners (doctor)', ['doctor'], 'aal2'],
    ['field staff', ['crew'], 'aal2'],
    ['staff without TOTP', ['operations'], 'aal1'],
  ])('refuses %s', async (_n, roles, aal) => {
    const { t } = await setup();
    expect((await get(t, OPS, roles, '/v1/residents', aal)).status).toBe(403);
  });
});

describe('resident profile', () => {
  it('care team sees consent state; medical access follows the proactive_care consent; the view is logged', async () => {
    const { t } = await setup();
    let body = (await (await get(t, OPS, ['operations'], `/v1/residents/${A}`)).json()) as { consents: { purpose: string; status: string }[]; medicalAccess: string; householdSize: number };
    expect(body.medicalAccess).toBe('not_granted');
    expect(body.consents.find((c) => c.purpose === 'proactive_care')!.status).toBe('not_asked');
    expect(body.householdSize).toBe(1);

    t.consentRows.push({ purpose: 'proactive_care', scopeKey: '', status: 'granted', noticeVersion: purposeMeta.proactive_care.noticeVersion, language: 'te', actedBy: A, userId: A, createdAt: new Date() });
    body = (await (await get(t, OPS, ['operations'], `/v1/residents/${A}`)).json()) as typeof body;
    expect(body.medicalAccess).toBe('granted');
    expect(t.residentViews).toEqual([
      { staffId: OPS, role: 'care_team', residentId: A },
      { staffId: OPS, role: 'care_team', residentId: A },
    ]);
  });

  it('the desk sees no consent detail and never medical access, even when the person opted in', async () => {
    const { t } = await setup();
    t.consentRows.push({ purpose: 'proactive_care', scopeKey: '', status: 'granted', noticeVersion: purposeMeta.proactive_care.noticeVersion, language: 'te', actedBy: A, userId: A, createdAt: new Date() });
    const body = (await (await get(t, DESK, ['community_desk'], `/v1/residents/${A}`)).json()) as { consents: unknown; medicalAccess: string };
    expect(body.consents).toBeNull();
    expect(body.medicalAccess).toBe('not_permitted');
  });

  it('a resident outside the desk’s community looks like it doesn’t exist', async () => {
    const { t } = await setup();
    expect((await get(t, DESK, ['community_desk'], `/v1/residents/${B}`)).status).toBe(404);
    expect(t.residentViews).toHaveLength(0);
  });
});
