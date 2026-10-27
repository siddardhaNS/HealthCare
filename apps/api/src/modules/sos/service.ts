import type { SosIncident } from '@repo/contracts';
import { checkTransition, sosThresholds, type SosActor, type SosState } from '@repo/contracts/sos';
import type { HouseholdsRepo } from '../households/repo';
import { canActFor } from '../households/service';
import type { EventRow, IncidentRow, SosRepo } from './repo';

export type SosFailure = { error: 'not_found' | 'forbidden' | 'illegal_transition' | 'not_your_move' | 'reason_required' | 'conflict'; message: string };
const fail = (error: SosFailure['error'], message: string): SosFailure => ({ error, message });
export const isSosFailure = (x: unknown): x is SosFailure => typeof x === 'object' && x !== null && 'error' in x;

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

/** Applies a state change through the state machine (compare-and-set against concurrent changes). */
export async function move(sos: SosRepo, incident: IncidentRow, to: SosState, actor: { id: string | null; role: SosActor }, reason: string | null): Promise<IncidentRow | SosFailure> {
  const check = checkTransition(incident.state, to, actor.role, reason);
  if (!check.ok) {
    const message = { illegal_transition: `An SOS that is ${incident.state} cannot become ${to}.`, not_your_move: 'You cannot make this change.', reason_required: 'Give a reason for this change.' }[check.code];
    return fail(check.code, message);
  }
  const next = await sos.transition(incident.id, incident.state, to, actor, reason);
  return next ?? fail('conflict', 'The SOS changed meanwhile. Refresh and try again.');
}

/** The person or a family manager can see and cancel. */
export async function loadForPerson(repos: { sos: SosRepo; households: HouseholdsRepo }, me: string, id: string): Promise<IncidentRow | SosFailure> {
  const incident = await repos.sos.get(id);
  if (!incident || !(await canActFor(repos.households, me, incident.userId))) return fail('not_found', 'No such SOS.');
  return incident;
}
