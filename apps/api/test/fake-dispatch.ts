import { randomUUID } from 'node:crypto';
import { crewActiveStates } from '@repo/contracts/sos';
import type { LatLng } from '../src/lib/crew-locator';
import type { CrewRow, DispatchRepo, OfferRow } from '../src/modules/dispatch/repo';
import type { IncidentRow } from '../src/modules/sos/repo';

/** In-memory DispatchRepo mirroring the database rules; reads incidents from the fake SOS repo. */
export function fakeDispatch(incidents: () => IncidentRow[]) {
  const crews: CrewRow[] = [];
  const onDuty = new Set<string>();
  const offers: OfferRow[] = [];
  const teams = new Map<string, { name: string; active: boolean }>();
  /** household → team (stand-alone), and household → site via its home. */
  const householdTeam = new Map<string, string>();
  const householdSite = new Map<string, string>();
  const siteTeam = new Map<string, string>();
  const householdAt = new Map<string, LatLng>();
  const audit: { crewId: string; action: string }[] = [];
  let clock = Date.parse('2026-10-27T10:00:00Z');

  const repo: DispatchRepo = {
    async crewByUser(userId) {
      return crews.find((c) => c.userId === userId) ?? null;
    },
    async isOnDuty(crewId) {
      return onDuty.has(crewId);
    },
    async setDuty(crew, on) {
      if (on === onDuty.has(crew.id)) return;
      if (on) onDuty.add(crew.id);
      else onDuty.delete(crew.id);
      audit.push({ crewId: crew.id, action: on ? 'crew_on_duty' : 'crew_off_duty' });
    },
    async available({ incidentId, isDrill, teamId, crewIds }) {
      const busy = new Set(incidents().filter((i) => i.crewId && crewActiveStates.includes(i.state)).map((i) => i.crewId!));
      return crews
        .filter(
          (c) =>
            c.active &&
            onDuty.has(c.id) &&
            !busy.has(c.id) &&
            !offers.some((o) => o.crewId === c.id && o.incidentId === incidentId) &&
            (!isDrill || c.drillParticipant) &&
            (!teamId || c.teamId === teamId) &&
            (!crewIds || crewIds.includes(c.id)),
        )
        .map((c) => ({ id: c.id, teamId: c.teamId }));
    },
    async teamForHousehold(householdId) {
      const site = householdSite.get(householdId);
      const team = (site ? siteTeam.get(site) : undefined) ?? householdTeam.get(householdId);
      return team && teams.get(team)?.active ? team : null;
    },
    async householdLocation(householdId) {
      return householdAt.get(householdId) ?? null;
    },
    async createOffers(incidentId, list) {
      const made = list
        .filter((o) => !offers.some((x) => x.incidentId === incidentId && x.crewId === o.crewId))
        .map((o) => ({ id: randomUUID(), incidentId, crewId: o.crewId, ring: o.ring, etaS: o.etaS, response: null, createdAt: new Date((clock += 1000)) }) satisfies OfferRow);
      offers.push(...made);
      return made;
    },
    async offer(id) {
      const o = offers.find((x) => x.id === id);
      return o ? { ...o } : null;
    },
    async pendingForCrew(crewId) {
      return offers
        .filter((o) => o.crewId === crewId && o.response === null)
        .flatMap((o) => {
          const i = incidents().find((x) => x.id === o.incidentId);
          if (!i || (i.state !== 'dispatching' && i.state !== 'escalated_to_108')) return [];
          return [{ ...o, isDrill: i.isDrill, location: i.lat !== null && i.lng !== null ? { lat: i.lat, lng: i.lng } : null }];
        });
    },
    async respond(id, response) {
      const o = offers.find((x) => x.id === id);
      if (!o || o.response) return false;
      o.response = response;
      return true;
    },
    async releaseOthers(incidentId, keep) {
      for (const o of offers) if (o.incidentId === incidentId && o.id !== keep && !o.response) o.response = 'released';
    },
  };

  /** Adds a crew (on duty unless told otherwise). */
  const addCrew = (p: Partial<CrewRow> & { userId?: string } = {}, opts: { onDuty?: boolean } = {}) => {
    const crew: CrewRow = { id: randomUUID(), userId: p.userId ?? randomUUID(), teamId: p.teamId ?? null, teamName: p.teamId ? (teams.get(p.teamId)?.name ?? null) : null, drillParticipant: p.drillParticipant ?? false, active: p.active ?? true };
    crews.push(crew);
    if (opts.onDuty ?? true) onDuty.add(crew.id);
    return crew;
  };
  const addTeam = (name: string, active = true) => {
    const id = randomUUID();
    teams.set(id, { name, active });
    return id;
  };

  return { repo, crews, offers, onDuty, audit, addCrew, addTeam, householdTeam, householdSite, siteTeam, householdAt };
}
