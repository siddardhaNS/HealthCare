import { randomUUID } from 'node:crypto';
import { sosThresholds } from '@repo/contracts/sos';
import type { CoverageRepo, TeamRow } from '../src/modules/coverage/repo';
import type { SosSettingsRepo } from '../src/modules/sos/settings-repo';
import type { fakeDispatch } from './fake-dispatch';
import type { fakeHouseholds } from './fake-households';
import type { fakeSos } from './fake-sos';

/**
 * In-memory CoverageRepo sharing state with the dispatch fake (crew teams,
 * team coverage) and the households fake (sites, stand-alone homes), so
 * dispatch and the residents directory see the same assignments.
 */
export function fakeCoverage(dispatch: ReturnType<typeof fakeDispatch>, hh: ReturnType<typeof fakeHouseholds>) {
  const teams: TeamRow[] = [];
  const ambulances: { id: string; registration: string; teamId: string | null }[] = [];
  const audit: { action: string; entityId: string; metadata: Record<string, unknown> }[] = [];
  const crewNames = new Map<string, string>();

  const teamOf = (siteId: string | null, householdId: string) => (siteId ? dispatch.siteTeam.get(siteId) : dispatch.householdTeam.get(householdId)) ?? null;
  hh.linkCoverage((siteId, householdId) => {
    const t = teams.find((x) => x.id === teamOf(siteId, householdId));
    return t?.active ? t.name : null;
  });
  const syncDispatchTeam = (t: TeamRow) => dispatch.teams.set(t.id, { name: t.name, active: t.active });
  const siteHouseholds = (siteId: string) => hh.households.filter((h) => hh.homes.find((m) => m.id === h.homeId)?.siteId === siteId).length;

  const repo: CoverageRepo = {
    async teams() {
      return teams.map((t) => {
        const sites = [...dispatch.siteTeam].filter(([, tid]) => tid === t.id).map(([sid]) => sid);
        const homes = [...dispatch.householdTeam].filter(([, tid]) => tid === t.id).length;
        return {
          ...t,
          crews: dispatch.crews.filter((c) => c.active && c.teamId === t.id).map((c) => ({ crewId: c.id, name: crewNames.get(c.id) ?? null, onDuty: dispatch.onDuty.has(c.id) })),
          ambulances: ambulances.filter((a) => a.teamId === t.id).map(({ id, registration }) => ({ id, registration })),
          sites: sites.length,
          homes,
          households: homes + sites.reduce((n, s) => n + siteHouseholds(s), 0),
        };
      });
    },
    async team(id) {
      return teams.find((t) => t.id === id) ?? null;
    },
    async roster() {
      return {
        crews: dispatch.crews.filter((c) => c.active).map((c) => ({ crewId: c.id, name: crewNames.get(c.id) ?? null, teamId: c.teamId })),
        ambulances: ambulances.map((a) => ({ ...a })),
      };
    },
    async createTeam(t, actor) {
      const row = { id: randomUUID(), name: t.name, area: t.area, active: true };
      teams.push(row);
      syncDispatchTeam(row);
      audit.push({ action: 'coverage_team_created', entityId: row.id, metadata: { actor } });
      return { ...row };
    },
    async updateTeam(id, change) {
      const t = teams.find((x) => x.id === id);
      if (!t) return null;
      Object.assign(t, change);
      syncDispatchTeam(t);
      audit.push({ action: 'coverage_team_updated', entityId: id, metadata: change });
      return { ...t };
    },
    async setCrewTeam(crewId, teamId) {
      const c = dispatch.crews.find((x) => x.id === crewId && x.active);
      if (!c) return false;
      audit.push({ action: 'coverage_crew_moved', entityId: crewId, metadata: { from: c.teamId, to: teamId } });
      c.teamId = teamId;
      return true;
    },
    async setAmbulanceTeam(id, teamId) {
      const a = ambulances.find((x) => x.id === id);
      if (!a) return false;
      audit.push({ action: 'coverage_ambulance_moved', entityId: id, metadata: { from: a.teamId, to: teamId } });
      a.teamId = teamId;
      return true;
    },
    async places({ uncovered, q }) {
      const name = (t: string | null) => (t ? (teams.find((x) => x.id === t)?.name ?? null) : null);
      const all = [
        ...hh.sites.map((s) => ({ kind: 'site' as const, id: s.id, name: s.name, city: s.city, households: siteHouseholds(s.id), teamId: dispatch.siteTeam.get(s.id) ?? null })),
        ...hh.households
          .filter((h) => h.homeId === null)
          .map((h) => ({ kind: 'household' as const, id: h.id, name: h.name ?? '', city: h.city, households: 1, teamId: dispatch.householdTeam.get(h.id) ?? null })),
      ];
      return all
        .filter((p) => (!uncovered || !p.teamId) && (!q || `${p.name} ${p.city}`.toLowerCase().includes(q.toLowerCase())))
        .map((p) => ({ ...p, teamName: name(p.teamId) }));
    },
    async assign(teamId, { sites, households }) {
      if (teamId) {
        const t = teams.find((x) => x.id === teamId);
        if (!t) return { ok: false, error: 'no_team' };
        if (!t.active) return { ok: false, error: 'team_inactive' };
      }
      if (sites.some((s) => !hh.sites.some((x) => x.id === s)) || households.some((h) => !hh.households.some((x) => x.id === h))) return { ok: false, error: 'unknown_place' };
      if (households.some((h) => hh.households.find((x) => x.id === h)!.homeId !== null)) return { ok: false, error: 'not_standalone' };
      let changed = 0;
      for (const [map, ids, kind] of [[dispatch.siteTeam, sites, 'site'], [dispatch.householdTeam, households, 'household']] as const) {
        for (const id of ids) {
          const from = map.get(id) ?? null;
          if (teamId) map.set(id, teamId);
          else map.delete(id);
          if (from !== teamId) {
            changed++;
            audit.push({ action: teamId ? 'coverage_assigned' : 'coverage_removed', entityId: id, metadata: { kind, from, to: teamId } });
          }
        }
      }
      return { ok: true, changed };
    },
  };
  return { repo, teams, ambulances, audit, crewNames };
}

/** In-memory thresholds over the households fake's sites and the SOS fake's settings (what raise() reads). */
export function fakeSosSettings(hh: ReturnType<typeof fakeHouseholds>, sos: ReturnType<typeof fakeSos>) {
  const audit: { siteId: string; from: unknown; to: unknown }[] = [];
  const list: SosSettingsRepo['list'] = async (ids) =>
    hh.sites
      .filter((s) => ids === 'all' || ids.includes(s.id))
      .map((s) => {
        const v = sos.settings.get(s.id);
        return { siteId: s.id, name: s.name, city: s.city, widenAfterS: v?.widenAfterS ?? sosThresholds.widenDefault, escalateAfterS: v?.escalateAfterS ?? sosThresholds.escalateDefault, custom: !!v, updatedAt: v ? new Date('2026-10-30T10:00:00Z') : null };
      });
  const repo: SosSettingsRepo = {
    list,
    async set(siteId, v) {
      const [before] = await list([siteId]);
      if (!before) return null;
      sos.settings.set(siteId, v);
      audit.push({ siteId, from: { widen: before.widenAfterS, escalate: before.escalateAfterS }, to: { widen: v.widenAfterS, escalate: v.escalateAfterS } });
      return (await list([siteId]))[0]!;
    },
  };
  return { repo, audit };
}
