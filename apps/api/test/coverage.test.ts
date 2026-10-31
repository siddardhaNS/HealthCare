import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CoveragePlace, CoverageTeams, SiteSosSettingsList } from '@repo/contracts';
import { testContext } from './helpers';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OPS = '44444444-4444-4444-8444-444444444444';
const DESK = '22222222-2222-4222-8222-222222222222';
const A = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const B = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';

async function setup() {
  const t = await testContext();
  const green = t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
  const palm = t.hh.addSite({ name: 'Palm Villas', kind: 'gated', city: 'Hyderabad', joinCode: 'PALM777', homes: [{ tower: null, number: '42' }] });
  await t.hh.repo.createHousehold({ homeId: (await t.hh.repo.findHome(green.id, 'B', '1204'))!.id, city: 'Hyderabad' }, A);
  const standalone = await t.hh.repo.createHousehold({ homeId: null, city: 'Vijayawada', name: 'Rao family' }, B);
  t.deskScopes.set(DESK, [green.id]);
  const as = async (sub: string, roles: string[], aal = 'aal2') => {
    const h = { authorization: `Bearer ${await t.token({ sub, aal, app_roles: roles })}`, 'content-type': 'application/json' };
    const call = (method: string, p: string, b?: unknown) => t.app.request(p, { method, headers: h, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    return { get: (p: string) => call('GET', p), post: (p: string, b: unknown) => call('POST', p, b), put: (p: string, b: unknown) => call('PUT', p, b), patch: (p: string, b: unknown) => call('PATCH', p, b) };
  };
  return { t, green, palm, standalone, admin: await as(ADMIN, ['super_admin']), ops: await as(OPS, ['operations']), desk: await as(DESK, ['community_desk']), as };
}

describe('SOS thresholds per community', () => {
  it('lists every community with the defaults until changed; only a super admin may edit', async () => {
    const s = await setup();
    const list = (await (await s.ops.get('/v1/sos-settings')).json()) as SiteSosSettingsList;
    expect(list).toMatchObject({ canEdit: false, defaults: { widenAfterS: 30, escalateAfterS: 90 } });
    expect(list.sites.map((x) => [x.name, x.widenAfterS, x.escalateAfterS, x.custom])).toEqual([
      ['Green Meadows', 30, 90, false],
      ['Palm Villas', 30, 90, false],
    ]);
    expect((await s.ops.put(`/v1/sos-settings/${s.green.id}`, { widenAfterS: 20, escalateAfterS: 75 })).status).toBe(403);
    expect(((await (await s.admin.get('/v1/sos-settings')).json()) as SiteSosSettingsList).canEdit).toBe(true);
  });

  it('the community desk sees only its own community', async () => {
    const s = await setup();
    const list = (await (await s.desk.get('/v1/sos-settings')).json()) as SiteSosSettingsList;
    expect(list.sites.map((x) => x.name)).toEqual(['Green Meadows']);
    expect((await s.desk.put(`/v1/sos-settings/${s.green.id}`, { widenAfterS: 20, escalateAfterS: 75 })).status).toBe(403);
  });

  it('a change is audited and applies to the next SOS from that community', async () => {
    const s = await setup();
    const res = await s.admin.put(`/v1/sos-settings/${s.green.id}`, { widenAfterS: 20, escalateAfterS: 75 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ widenAfterS: 20, escalateAfterS: 75, custom: true });
    expect(s.t.sosSettings.audit).toEqual([{ siteId: s.green.id, from: { widen: 30, escalate: 90 }, to: { widen: 20, escalate: 75 } }]);
    const sos = await (await s.as(A, [])).post('/v1/sos', { idempotencyKey: randomUUID() });
    expect(await sos.json()).toMatchObject({ widenAfterS: 20, escalateAfterS: 75 });
  });

  it.each([
    [{ widenAfterS: 10, escalateAfterS: 90 }, 'widen below 15 s'],
    [{ widenAfterS: 61, escalateAfterS: 120 }, 'widen above 60 s'],
    [{ widenAfterS: 30, escalateAfterS: 200 }, '108 above 180 s'],
    [{ widenAfterS: 60, escalateAfterS: 60 }, '108 not after widening'],
  ])('refuses %o (%s)', async (body) => {
    const s = await setup();
    expect((await s.admin.put(`/v1/sos-settings/${s.green.id}`, body)).status).toBe(400);
    expect(s.t.sosSettings.audit).toEqual([]);
  });

  it('an unknown community is 404', async () => {
    const s = await setup();
    expect((await s.admin.put(`/v1/sos-settings/${randomUUID()}`, { widenAfterS: 20, escalateAfterS: 75 })).status).toBe(404);
  });
});

describe('coverage teams', () => {
  const teams = async (s: Awaited<ReturnType<typeof setup>>) => (await (await s.ops.get('/v1/coverage/teams')).json()) as CoverageTeams;
  const places = async (s: Awaited<ReturnType<typeof setup>>, q = '') => ((await (await s.ops.get(`/v1/coverage/places${q}`)).json()) as { places: CoveragePlace[] }).places;

  it('only super admin and operations manage teams; the desk and support cannot', async () => {
    const s = await setup();
    expect((await s.desk.get('/v1/coverage/teams')).status).toBe(403);
    expect((await (await s.as(OPS, ['support'])).get('/v1/coverage/teams')).status).toBe(403);
    expect((await (await s.as(OPS, ['operations'], 'aal1')).get('/v1/coverage/teams')).status).toBe(403);
    expect((await s.admin.get('/v1/coverage/teams')).status).toBe(200);
  });

  it('creates a team, adds crews and the ambulance, and moving a crew takes them out of their old team', async () => {
    const s = await setup();
    const abc = (await (await s.ops.post('/v1/coverage/teams', { name: 'ABC team', area: 'Gachibowli' })).json()) as { id: string };
    const xyz = (await (await s.ops.post('/v1/coverage/teams', { name: 'XYZ team' })).json()) as { id: string };
    const crew = s.t.dispatch.addCrew();
    s.t.coverage.crewNames.set(crew.id, 'Ravi Kumar');
    s.t.coverage.ambulances.push({ id: randomUUID(), registration: 'TS 09 EA 1234', teamId: null });
    const amb = s.t.coverage.ambulances[0]!;

    expect((await s.ops.put(`/v1/coverage/crews/${crew.id}/team`, { teamId: abc.id })).status).toBe(204);
    expect((await s.ops.put(`/v1/coverage/ambulances/${amb.id}/team`, { teamId: abc.id })).status).toBe(204);
    let list = await teams(s);
    expect(list.teams.find((x) => x.id === abc.id)).toMatchObject({ area: 'Gachibowli', crews: [{ crewId: crew.id, name: 'Ravi Kumar', onDuty: true }], ambulances: [{ registration: 'TS 09 EA 1234' }] });

    await s.ops.put(`/v1/coverage/crews/${crew.id}/team`, { teamId: xyz.id });
    list = await teams(s);
    expect(list.teams.find((x) => x.id === abc.id)!.crews).toEqual([]);
    expect(list.teams.find((x) => x.id === xyz.id)!.crews.map((c) => c.crewId)).toEqual([crew.id]);
    expect(list.roster.crews.find((c) => c.crewId === crew.id)!.teamId).toBe(xyz.id);

    expect((await s.ops.put(`/v1/coverage/crews/${randomUUID()}/team`, { teamId: abc.id })).status).toBe(404);
    expect((await s.ops.put(`/v1/coverage/crews/${crew.id}/team`, { teamId: randomUUID() })).status).toBe(404);
    expect(s.t.coverage.audit.map((a) => a.action)).toEqual(['coverage_team_created', 'coverage_team_created', 'coverage_crew_moved', 'coverage_ambulance_moved', 'coverage_crew_moved']);
  });

  it('assigns communities and stand-alone homes in bulk; one team per place, so assigning again moves it', async () => {
    const s = await setup();
    const abc = (await (await s.ops.post('/v1/coverage/teams', { name: 'ABC team' })).json()) as { id: string };
    const xyz = (await (await s.ops.post('/v1/coverage/teams', { name: 'XYZ team' })).json()) as { id: string };
    expect((await places(s, '?uncovered=true')).map((p) => [p.kind, p.name])).toEqual([
      ['site', 'Green Meadows'],
      ['site', 'Palm Villas'],
      ['household', 'Rao family'],
    ]);

    const res = await s.ops.put('/v1/coverage/assignments', { teamId: abc.id, sites: [s.green.id], households: [s.standalone] });
    expect(await res.json()).toEqual({ changed: 2 });
    expect((await places(s, '?uncovered=true')).map((p) => p.name)).toEqual(['Palm Villas']);
    expect((await teams(s)).teams.find((x) => x.id === abc.id)).toMatchObject({ sites: 1, homes: 1, households: 2 });

    // Moving Green Meadows to XYZ: one action, ABC no longer covers it.
    expect(await (await s.ops.put('/v1/coverage/assignments', { teamId: xyz.id, sites: [s.green.id] })).json()).toEqual({ changed: 1 });
    expect((await places(s)).find((p) => p.id === s.green.id)).toMatchObject({ teamId: xyz.id, teamName: 'XYZ team' });
    // Unassign.
    await s.ops.put('/v1/coverage/assignments', { teamId: null, households: [s.standalone] });
    expect((await places(s)).find((p) => p.id === s.standalone)).toMatchObject({ teamId: null });
    expect(s.t.coverage.audit.filter((a) => a.action.startsWith('coverage_assigned') || a.action === 'coverage_removed').map((a) => [a.action, a.metadata.from, a.metadata.to])).toEqual([
      ['coverage_assigned', null, abc.id],
      ['coverage_assigned', null, abc.id],
      ['coverage_assigned', abc.id, xyz.id],
      ['coverage_removed', abc.id, null],
    ]);
  });

  it('refuses homes inside a community, inactive teams and empty requests', async () => {
    const s = await setup();
    const abc = (await (await s.ops.post('/v1/coverage/teams', { name: 'ABC team' })).json()) as { id: string };
    const inGreen = s.t.hh.households.find((h) => h.homeId !== null)!.id;
    expect((await s.ops.put('/v1/coverage/assignments', { teamId: abc.id, households: [inGreen] })).status).toBe(400);
    expect((await s.ops.put('/v1/coverage/assignments', { teamId: abc.id })).status).toBe(400);
    await s.ops.patch(`/v1/coverage/teams/${abc.id}`, { active: false });
    expect((await s.ops.put('/v1/coverage/assignments', { teamId: abc.id, sites: [s.palm.id] })).status).toBe(409);
    expect((await s.ops.put('/v1/coverage/assignments', { teamId: randomUUID(), sites: [s.palm.id] })).status).toBe(404);
  });

  it('renames and deactivates a team; an inactive team stops covering in the directory', async () => {
    const s = await setup();
    const abc = (await (await s.ops.post('/v1/coverage/teams', { name: 'ABC team' })).json()) as { id: string };
    await s.ops.put('/v1/coverage/assignments', { teamId: abc.id, sites: [s.green.id], households: [s.standalone] });
    expect(await s.t.dispatch.repo.teamsForHousehold(s.standalone)).toEqual([abc.id]);
    const directory = async () => ((await (await s.desk.get('/v1/residents')).json()) as { residents: { coverageTeam: string | null }[] }).residents[0]!.coverageTeam;
    expect(await directory()).toBe('ABC team');
    expect(await (await s.ops.patch(`/v1/coverage/teams/${abc.id}`, { name: 'ABC · Gachibowli', area: '' })).json()).toMatchObject({ name: 'ABC · Gachibowli', area: null });
    expect(await directory()).toBe('ABC · Gachibowli');
    await s.ops.patch(`/v1/coverage/teams/${abc.id}`, { active: false });
    expect(await directory()).toBeNull();
    expect(await s.t.dispatch.repo.teamsForHousehold(s.standalone)).toEqual([]);
    expect((await s.ops.patch(`/v1/coverage/teams/${randomUUID()}`, { active: false })).status).toBe(404);
  });

  describe('backup teams (plan §11)', () => {
    const team = async (s: Awaited<ReturnType<typeof setup>>, name: string) => ((await (await s.ops.post('/v1/coverage/teams', { name })).json()) as { id: string }).id;
    const backupsOf = async (s: Awaited<ReturnType<typeof setup>>, id: string) => (await places(s)).find((p) => p.id === id)!.backups.map((b) => b.teamName);

    it('adds backups in bulk, in order, after a primary; skips places the team already covers', async () => {
      const s = await setup();
      const [abc, xyz, pqr] = [await team(s, 'ABC'), await team(s, 'XYZ'), await team(s, 'PQR')];
      // No primary yet: a backup alone would become the first ring.
      expect((await s.ops.put('/v1/coverage/assignments', { teamId: xyz, as: 'backup', sites: [s.green.id] })).status).toBe(409);
      await s.ops.put('/v1/coverage/assignments', { teamId: abc, sites: [s.green.id], households: [s.standalone] });
      expect(await (await s.ops.put('/v1/coverage/assignments', { teamId: xyz, as: 'backup', sites: [s.green.id], households: [s.standalone] })).json()).toEqual({ changed: 2 });
      expect(await (await s.ops.put('/v1/coverage/assignments', { teamId: pqr, as: 'backup', sites: [s.green.id] })).json()).toEqual({ changed: 1 });
      // Already the primary, or already a backup: nothing changes.
      expect(await (await s.ops.put('/v1/coverage/assignments', { teamId: abc, as: 'backup', sites: [s.green.id] })).json()).toEqual({ changed: 0 });
      expect(await (await s.ops.put('/v1/coverage/assignments', { teamId: xyz, as: 'backup', sites: [s.green.id] })).json()).toEqual({ changed: 0 });
      expect(await backupsOf(s, s.green.id)).toEqual(['XYZ', 'PQR']);
      expect((await places(s)).find((p) => p.id === s.green.id)).toMatchObject({ teamName: 'ABC' });
      // Dispatch tries them in this order.
      expect(await s.t.dispatch.repo.teamsForHousehold(s.standalone)).toEqual([abc, xyz]);
      expect((await s.ops.put('/v1/coverage/assignments', { teamId: null, as: 'backup', sites: [s.green.id] })).status).toBe(400);
    });

    it('reorders and removes with one ordered list; refuses duplicates, the primary and new inactive teams', async () => {
      const s = await setup();
      const [abc, xyz, pqr] = [await team(s, 'ABC'), await team(s, 'XYZ'), await team(s, 'PQR')];
      await s.ops.put('/v1/coverage/assignments', { teamId: abc, households: [s.standalone] });
      const set = (teamIds: string[]) => s.ops.put('/v1/coverage/backups', { kind: 'household', id: s.standalone, teamIds });
      expect(await (await set([xyz, pqr])).json()).toEqual({ changed: true });
      expect(await (await set([pqr, xyz])).json()).toEqual({ changed: true });
      expect(await s.t.dispatch.repo.teamsForHousehold(s.standalone)).toEqual([abc, pqr, xyz]);
      expect(await (await set([pqr, xyz])).json()).toEqual({ changed: false });
      expect((await set([xyz, xyz])).status).toBe(400);
      expect((await set([abc])).status).toBe(409);
      expect((await set([randomUUID()])).status).toBe(404);
      // An inactive team already on the list may stay (dispatch skips it); it cannot be added anew.
      await s.ops.patch(`/v1/coverage/teams/${pqr}`, { active: false });
      expect(await s.t.dispatch.repo.teamsForHousehold(s.standalone)).toEqual([abc, xyz]);
      expect((await places(s)).find((p) => p.id === s.standalone)!.backups).toEqual([
        { teamId: pqr, teamName: 'PQR', active: false },
        { teamId: xyz, teamName: 'XYZ', active: true },
      ]);
      expect(await (await set([xyz, pqr])).json()).toEqual({ changed: true });
      expect((await set([])).status).toBe(200);
      await s.ops.patch(`/v1/coverage/teams/${pqr}`, { active: true });
      await s.ops.patch(`/v1/coverage/teams/${xyz}`, { active: false });
      expect((await set([xyz])).status).toBe(409);
      expect(s.t.coverage.audit.filter((a) => a.action === 'coverage_backups_set').map((a) => a.metadata.to)).toEqual([[xyz, pqr], [pqr, xyz], [xyz, pqr], []]);
    });

    it('refuses homes inside a community and unknown places; the desk cannot change backups', async () => {
      const s = await setup();
      const inGreen = s.t.hh.households.find((h) => h.homeId !== null)!.id;
      expect((await s.ops.put('/v1/coverage/backups', { kind: 'household', id: inGreen, teamIds: [] })).status).toBe(400);
      expect((await s.ops.put('/v1/coverage/backups', { kind: 'site', id: randomUUID(), teamIds: [] })).status).toBe(404);
      expect((await s.desk.put('/v1/coverage/backups', { kind: 'site', id: s.green.id, teamIds: [] })).status).toBe(403);
    });

    it('a backup made primary leaves the backup list; removing the cover removes the backups', async () => {
      const s = await setup();
      const [abc, xyz, pqr] = [await team(s, 'ABC'), await team(s, 'XYZ'), await team(s, 'PQR')];
      await s.ops.put('/v1/coverage/assignments', { teamId: abc, sites: [s.green.id] });
      await s.ops.put('/v1/coverage/backups', { kind: 'site', id: s.green.id, teamIds: [xyz, pqr] });
      await s.ops.put('/v1/coverage/assignments', { teamId: xyz, sites: [s.green.id] });
      expect((await places(s)).find((p) => p.id === s.green.id)).toMatchObject({ teamName: 'XYZ', backups: [{ teamName: 'PQR' }] });
      await s.ops.put('/v1/coverage/assignments', { teamId: null, sites: [s.green.id] });
      expect((await places(s)).find((p) => p.id === s.green.id)).toMatchObject({ teamId: null, backups: [] });
    });
  });

  it('dispatch offers a stand-alone home’s SOS to the team assigned here', async () => {
    const s = await setup();
    const abc = (await (await s.ops.post('/v1/coverage/teams', { name: 'ABC team' })).json()) as { id: string };
    await s.ops.put('/v1/coverage/assignments', { teamId: abc.id, households: [s.standalone] });
    expect(await s.t.dispatch.repo.teamsForHousehold(s.standalone)).toEqual([abc.id]);
  });
});
