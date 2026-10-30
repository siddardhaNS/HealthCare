import { crewActiveStates } from '@repo/contracts/sos';
import type { LatLng } from '../src/lib/crew-locator';
import type { DeskRepo } from '../src/modules/sos/desk-repo';
import type { fakeDispatch } from './fake-dispatch';
import type { fakeHouseholds } from './fake-households';
import type { fakeSos } from './fake-sos';

/** In-memory DeskRepo joining the SOS, dispatch and household fakes the way the SQL does. */
export function fakeDesk(sos: ReturnType<typeof fakeSos>, dispatch: ReturnType<typeof fakeDispatch>, hh: ReturnType<typeof fakeHouseholds>) {
  const crewNames = new Map<string, string>();
  /** Sites known to the command center, with their centre (null: no boundary or homes with a location). */
  const sites = new Map<string, { name: string; city: string; centre: LatLng | null }>();
  const closed = (s: string) => s === 'closed' || s === 'cancelled';

  const row = async (i: (typeof sos.incidents)[number]) => {
    const who = (await hh.residents()).find((r) => r.userId === i.userId);
    const { idempotencyKey: _k, ...incident } = i;
    const last = (sos.events.get(i.id) ?? []).at(-1);
    return {
      ...incident,
      closedAt: closed(i.state) ? (last?.createdAt ?? null) : null,
      residentName: who?.fullName ?? null,
      community: who?.community ?? (i.siteId ? (sites.get(i.siteId)?.name ?? null) : null),
      tower: who?.tower ?? null,
      number: who?.number ?? null,
      city: who?.city ?? null,
    };
  };
  const team = (crewId: string) => {
    const c = dispatch.crews.find((x) => x.id === crewId);
    return c?.teamId ? (dispatch.teams.get(c.teamId)?.name ?? null) : null;
  };

  const repo: DeskRepo = {
    async incidents({ siteIds, open }) {
      const list = sos.incidents.filter((i) => (siteIds === 'all' || (i.siteId && siteIds.includes(i.siteId))) && closed(i.state) !== open);
      return Promise.all([...list].reverse().map(row));
    },
    async incident(id) {
      const i = sos.incidents.find((x) => x.id === id);
      return i ? row(i) : null;
    },
    async offers(incidentId) {
      return dispatch.offers
        .filter((o) => o.incidentId === incidentId)
        .map((o) => ({ crewId: o.crewId, crewName: crewNames.get(o.crewId) ?? null, registration: dispatch.vehicles.get(o.crewId)?.registration ?? null, ring: o.ring, createdAt: o.createdAt, response: o.response }));
    },
    async crewInfo(crewId) {
      return dispatch.crews.some((c) => c.id === crewId) ? { name: crewNames.get(crewId) ?? null, team: team(crewId) } : null;
    },
    async fleet() {
      return dispatch.crews
        .filter((c) => c.active)
        .map((c) => {
          const v = dispatch.vehicles.get(c.id);
          const job = sos.incidents.find((i) => i.crewId === c.id && crewActiveStates.includes(i.state));
          return { crewId: c.id, name: crewNames.get(c.id) ?? null, team: team(c.id), registration: v?.registration ?? null, equipment: v?.equipment ?? null, onDuty: dispatch.onDuty.has(c.id), drillParticipant: c.drillParticipant, incidentId: job?.id ?? null };
        });
    },
    async sites(siteIds) {
      return [...sites].filter(([id]) => siteIds === 'all' || siteIds.includes(id)).map(([id, s]) => ({ id, name: s.name, city: s.city }));
    },
    async siteCentre(siteId) {
      return sites.get(siteId)?.centre ?? null;
    },
  };
  return { repo, crewNames, sites };
}
