// Dispatch: who is offered an SOS, and the first-accept-wins rule.
// docs/plans/phase-3-sos.md §3.4 and §9 (coverage teams).
import { estimateEtaS, type CrewStep } from '@repo/contracts/sos';
import type { Kv } from '../../lib/kv';
import type { CrewLocator, LatLng } from '../../lib/crew-locator';
import type { Realtime } from '../../lib/realtime';
import { publishCrewPosition } from '../sos/live';
import type { IncidentRow, SosRepo } from '../sos/repo';
import { acceptForCrew, type EscalationRunner, type SosAlerts } from '../sos/escalation-service';
import { isSosFailure, move, type SosFailure } from '../sos/transition';
import type { CrewRow, DispatchRepo } from './repo';

/** Crews offered at once in each ring (plan: "the nearest 3 at the same time"). */
export const OFFERS_PER_RING = 3;
/** How far to look for crews by distance, per ring. */
export const SEARCH_RADIUS_M = { 1: 20_000, 2: 40_000 } as const;
/** How long the first accept holds the incident against a racing second accept. */
const ACCEPT_LOCK_S = 120;

export { estimateEtaS } from '@repo/contracts/sos';

export interface DispatchDeps {
  dispatch: DispatchRepo;
  locator: CrewLocator;
}

export interface Candidate {
  crewId: string;
  ring: 1 | 2;
  distanceM: number | null;
  etaS: number | null;
  /** From the household's coverage team. */
  team: boolean;
}

/** Where to dispatch to: the phone's location, else the household's home. */
async function dispatchPoint(d: DispatchDeps, incident: IncidentRow): Promise<LatLng | null> {
  if (incident.lat !== null && incident.lng !== null) return { lat: incident.lat, lng: incident.lng };
  return incident.householdId ? d.dispatch.householdLocation(incident.householdId) : null;
}

/**
 * Ring 1: the coverage team's available crews, nearest first, topped up with
 * the nearest other crews so the first offer always goes to up to three
 * (a short-staffed team never costs the resident the widen threshold).
 * Ring 2: the next nearest crews not yet offered.
 */
export async function chooseCandidates(d: DispatchDeps, incident: IncidentRow, ring: 1 | 2): Promise<Candidate[]> {
  const from = await dispatchPoint(d, incident);
  const picked: Candidate[] = [];
  const base = { incidentId: incident.id, isDrill: incident.isDrill };

  if (ring === 1 && incident.householdId) {
    const teamId = await d.dispatch.teamForHousehold(incident.householdId);
    if (teamId) {
      const team = await d.dispatch.available({ ...base, teamId });
      const dist = from ? await d.locator.distances(from, team.map((c) => c.id)) : new Map<string, number>();
      // Known distances first (nearest first); team crews without a fresh position still get the offer.
      const ordered = [...team].sort((a, b) => (dist.get(a.id) ?? Infinity) - (dist.get(b.id) ?? Infinity));
      for (const c of ordered.slice(0, OFFERS_PER_RING)) {
        const m = dist.get(c.id) ?? null;
        picked.push({ crewId: c.id, ring, distanceM: m, etaS: m === null ? null : estimateEtaS(m), team: true });
      }
    }
  }

  const room = OFFERS_PER_RING - picked.length;
  if (room > 0 && from) {
    const near = (await d.locator.nearby(from, SEARCH_RADIUS_M[ring], OFFERS_PER_RING * 4)).filter((n) => !picked.some((p) => p.crewId === n.crewId));
    const ok = new Set((await d.dispatch.available({ ...base, crewIds: near.map((n) => n.crewId) })).map((c) => c.id));
    for (const n of near.filter((x) => ok.has(x.crewId)).slice(0, room)) {
      picked.push({ crewId: n.crewId, ring, distanceM: n.distanceM, etaS: estimateEtaS(n.distanceM), team: false });
    }
  }
  return picked;
}

/**
 * The escalation workflow's side effects with real offers. Desk alarms and
 * the 108 prompt are logged until the console command center (step 6); the
 * ringing push to crews comes with the field app (step 4): until then crews
 * see offers by polling GET /v1/crew/offers.
 */
export function dispatchAlerts(d: DispatchDeps & { sos: SosRepo }): SosAlerts {
  const log = (event: string, i: IncidentRow, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: 'info', event, incidentId: i.id, drill: i.isDrill, ...extra }));
  return {
    async offerRing(incident, ring) {
      const candidates = await chooseCandidates(d, incident, ring);
      const offers = await d.dispatch.createOffers(
        incident.id,
        candidates.map((c) => ({ crewId: c.crewId, ring: c.ring, etaS: c.etaS })),
      );
      const team = candidates.filter((c) => c.team).length;
      await d.sos.recordAction(incident.id, 'sos_offers_sent', { subject_id: incident.userId, drill: incident.isDrill, ring, offers: offers.length, team_offers: team });
      if (offers.length === 0) console.warn(JSON.stringify({ level: 'warn', event: 'sos_no_crews', incidentId: incident.id, ring }));
      else log('sos_offer_ring', incident, { ring, offers: offers.length, teamOffers: team });
    },
    async alertDesk(incident, why) {
      log('sos_desk_alarm', incident, { why });
    },
    async prompt108(incident) {
      log('sos_prompt_108', incident);
    },
  };
}

export type DispatchFailure = SosFailure;

/**
 * A crew accepts. The first accept takes a short Redis lock on the incident;
 * the state compare-and-set in the database is the final word, so exactly one
 * crew gets the job even if the lock store hiccups. Losers see "taken".
 */
export async function acceptOffer(
  d: DispatchDeps & { kv: Kv; sos: SosRepo; escalation: EscalationRunner },
  crew: CrewRow,
  offerId: string,
): Promise<IncidentRow | DispatchFailure> {
  const offer = await d.dispatch.offer(offerId);
  if (!offer || offer.crewId !== crew.id) return { error: 'not_found', message: 'No such job offer.' };
  if (offer.response) return { error: 'conflict', message: 'This job has been taken or closed.' };

  const lock = `lock:incident:${offer.incidentId}`;
  if (!(await d.kv.claim(lock, crew.id, ACCEPT_LOCK_S))) {
    await d.dispatch.respond(offerId, 'released');
    return { error: 'conflict', message: 'Another crew took this job.' };
  }
  const accepted = await acceptForCrew({ sos: d.sos, escalation: d.escalation }, offer.incidentId, crew.id);
  if (isSosFailure(accepted)) {
    await d.kv.del(lock);
    await d.dispatch.respond(offerId, 'released');
    return accepted;
  }
  await d.dispatch.respond(offerId, 'accepted');
  await d.dispatch.releaseOthers(offer.incidentId, offerId);
  return accepted;
}

export async function declineOffer(d: DispatchDeps, crew: CrewRow, offerId: string): Promise<true | DispatchFailure> {
  const offer = await d.dispatch.offer(offerId);
  if (!offer || offer.crewId !== crew.id) return { error: 'not_found', message: 'No such job offer.' };
  if (!(await d.dispatch.respond(offerId, 'declined'))) return { error: 'conflict', message: 'This job has been taken or closed.' };
  return true;
}

/**
 * On duty: open a shift and (with a location) become findable. Off duty:
 * close it and drop out of the index, but never in the middle of a job
 * (the resident is waiting; the desk reassigns if the crew cannot go on).
 */
export async function setDuty(d: DispatchDeps & { sos: SosRepo }, crew: CrewRow, onDuty: boolean, at?: LatLng): Promise<true | DispatchFailure> {
  if (!onDuty && (await d.sos.activeForCrew(crew.id))) return { error: 'conflict', message: 'Hand over your current job before going off duty, or ask the desk to reassign it.' };
  await d.dispatch.setDuty(crew, onDuty);
  if (!onDuty) await d.locator.remove(crew.id);
  else if (at) await d.locator.set(crew.id, at);
  return true;
}

/**
 * The assigned crew's status buttons: en route → on scene → transporting →
 * handed over, one step at a time through the state machine. Pressing the
 * same step again (a retry on a weak network) returns the job unchanged.
 */
export async function advanceJob(d: { sos: SosRepo }, crew: CrewRow, incidentId: string, to: CrewStep): Promise<IncidentRow | DispatchFailure> {
  const incident = await d.sos.get(incidentId);
  if (!incident || incident.crewId !== crew.id) return { error: 'not_found', message: 'No such job.' };
  if (incident.state === to) return incident;
  return move(d.sos, incident, to, { id: crew.userId, role: 'crew' }, null);
}

/**
 * Batched fixes from the field app; the newest one is the crew's position.
 * Only while on duty. During a job it is also pushed to the incident's
 * channel, so the resident and the desk see the ambulance move.
 */
export async function reportLocation(d: DispatchDeps & { sos: SosRepo; realtime: Realtime }, crew: CrewRow, points: (LatLng & { at: string })[]): Promise<true | DispatchFailure> {
  if (!(await d.dispatch.isOnDuty(crew.id))) return { error: 'conflict', message: 'Go on duty to share your location.' };
  const latest = [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1)!;
  await d.locator.set(crew.id, { lat: latest.lat, lng: latest.lng });
  const job = await d.sos.activeForCrew(crew.id);
  if (job) await publishCrewPosition(d.realtime, job.id, latest);
  return true;
}
