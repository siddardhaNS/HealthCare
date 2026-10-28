import type { ResidentSos, SosCrewView, SosIncident } from '@repo/contracts';
import { crewActiveStates, distanceM, estimateEtaS, sosThresholds, type SosActor } from '@repo/contracts/sos';
import type { CrewLocator, LatLng } from '../../lib/crew-locator';
import type { DispatchRepo } from '../dispatch/repo';
import type { HouseholdsRepo } from '../households/repo';
import { canActFor } from '../households/service';
import type { EventRow, IncidentRow, SosRepo } from './repo';
import { fail, type SosFailure } from './transition';

export { isSosFailure, move, type SosFailure } from './transition';

export function toIncident(i: IncidentRow, events: EventRow[]): SosIncident {
  return {
    id: i.id,
    state: i.state,
    isDrill: i.isDrill,
    createdAt: i.createdAt.toISOString(),
    location: i.lat !== null && i.lng !== null ? { lat: i.lat, lng: i.lng, ...(i.accuracyM !== null ? { accuracyM: i.accuracyM } : {}) } : null,
    widenAfterS: i.widenAfterS,
    escalateAfterS: i.escalateAfterS,
    timeline: events.map((e) => ({ at: e.createdAt.toISOString(), from: e.fromState, to: e.toState, by: e.actorRole, reason: e.reason })),
  };
}

/** Where the ambulance is heading: the phone's location, else the household's home. */
export async function incidentPoint(dispatch: DispatchRepo, i: IncidentRow): Promise<LatLng | null> {
  if (i.lat !== null && i.lng !== null) return { lat: i.lat, lng: i.lng };
  return i.householdId ? dispatch.householdLocation(i.householdId) : null;
}

/**
 * The ambulance as the resident sees it, only while a crew has the job:
 * registration, the company work number, its last position and a fresh
 * distance and ETA (the app refetches every 30 s, brief §6).
 */
export async function crewView(d: { dispatch: DispatchRepo; locator: CrewLocator }, i: IncidentRow): Promise<SosCrewView | null> {
  if (!i.crewId || !crewActiveStates.includes(i.state)) return null;
  const [vehicle, at, to] = await Promise.all([d.dispatch.vehicle(i.crewId), d.locator.position(i.crewId), incidentPoint(d.dispatch, i)]);
  const m = at && to ? distanceM(at, to) : null;
  return {
    ambulance: vehicle ? { registration: vehicle.registration, equipment: vehicle.equipment } : null,
    workPhone: vehicle?.workPhone ?? null,
    position: at ? { lat: at.lat, lng: at.lng, at: new Date(at.at).toISOString() } : null,
    distanceM: m,
    etaS: m === null ? null : estimateEtaS(m),
  };
}

export async function residentView(d: { sos: SosRepo; dispatch: DispatchRepo; locator: CrewLocator }, i: IncidentRow): Promise<ResidentSos> {
  const [events, crew] = await Promise.all([d.sos.events(i.id), crewView(d, i)]);
  return { ...toIncident(i, events), crew };
}

interface RaiseInput {
  idempotencyKey: string;
  location?: { lat: number; lng: number; accuracyM?: number };
}

/**
 * Raises an SOS for `subject` (normally the signed-in person). Never fails
 * on a retry or a second press: the same key returns the same incident, and
 * an already-open incident is returned instead of creating another.
 */
export async function raise(
  repos: { sos: SosRepo; households: HouseholdsRepo },
  actor: { id: string; role: SosActor },
  subject: string,
  input: RaiseInput,
  opts: { isDrill?: boolean } = {},
): Promise<{ incident: IncidentRow; created: boolean }> {
  const replay = await repos.sos.byIdempotency(actor.id, input.idempotencyKey);
  if (replay) return { incident: replay, created: false };
  const open = await repos.sos.openForUser(subject);
  if (open) return { incident: open, created: false };

  const membership = await repos.households.membership(subject);
  const household = membership ? await repos.households.household(membership.householdId) : null;
  const home = household?.homeId ? await repos.households.home(household.homeId) : null;
  const siteId = home?.siteId ?? null;
  const settings = siteId ? await repos.sos.siteSettings(siteId) : null;

  try {
    const incident = await repos.sos.create({
      userId: subject,
      householdId: household?.id ?? null,
      siteId,
      raisedBy: actor.id,
      raisedByRole: actor.role,
      idempotencyKey: input.idempotencyKey,
      lat: input.location?.lat ?? null,
      lng: input.location?.lng ?? null,
      accuracyM: input.location?.accuracyM ?? null,
      isDrill: !!opts.isDrill,
      widenAfterS: settings?.widenAfterS ?? sosThresholds.widenDefault,
      escalateAfterS: settings?.escalateAfterS ?? sosThresholds.escalateDefault,
    });
    return { incident, created: true };
  } catch (err) {
    // Two presses raced: the database's one-open-incident rule won; return that one.
    if ((err as { code?: string }).code === '23505') {
      const existing = (await repos.sos.byIdempotency(actor.id, input.idempotencyKey)) ?? (await repos.sos.openForUser(subject));
      if (existing) return { incident: existing, created: false };
    }
    throw err;
  }
}

/** The person or a family manager can see and cancel. */
export async function loadForPerson(repos: { sos: SosRepo; households: HouseholdsRepo }, me: string, id: string): Promise<IncidentRow | SosFailure> {
  const incident = await repos.sos.get(id);
  if (!incident || !(await canActFor(repos.households, me, incident.userId))) return fail('not_found', 'No such SOS.');
  return incident;
}
