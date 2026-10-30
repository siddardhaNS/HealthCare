// Console command center: what staff see and do with an SOS (plan §5, §6).
// Every change goes through the state machine as the `desk` actor, so it is
// in the timeline and audit_events like any other.
import { randomUUID } from 'node:crypto';
import type { AppRole, DeskIncident, DeskIncidentDetail } from '@repo/contracts';
import { closeNeedsReason, crewActiveStates, deskActions, distanceM, estimateEtaS, sosRef } from '@repo/contracts/sos';
import type { CrewLocator } from '../../lib/crew-locator';
import type { Kv } from '../../lib/kv';
import type { DispatchRepo } from '../dispatch/repo';
import { acceptLockKey } from '../dispatch/service';
import type { HouseholdsRepo } from '../households/repo';
import type { DeskIncidentRow, DeskRepo } from './desk-repo';
import type { EscalationRunner } from './escalation-service';
import type { IncidentRow, SosRepo } from './repo';
import { crewView, incidentPoint, raise, startEscalation, toIncident } from './service';
import { fail, isSosFailure, move, type SosFailure } from './transition';

/** May open the command center. */
export const deskReadRoles = ['super_admin', 'operations', 'support', 'community_desk'] as const satisfies readonly AppRole[];
/** May act on incidents and run test SOS (support watches only). */
const actRoles: readonly AppRole[] = ['super_admin', 'operations', 'community_desk'];
/** See every community; the community desk sees its own. */
const allSitesRoles: readonly AppRole[] = ['super_admin', 'operations', 'support'];

export interface Staff {
  id: string;
  sites: string[] | 'all';
  canAct: boolean;
}

export function staffOf(auth: { userId: string; roles: AppRole[] }, deskSites: () => Promise<string[]>): Promise<Staff> {
  const canAct = auth.roles.some((r) => actRoles.includes(r));
  if (auth.roles.some((r) => allSitesRoles.includes(r))) return Promise.resolve({ id: auth.userId, sites: 'all', canAct });
  return deskSites().then((sites) => ({ id: auth.userId, sites, canAct }));
}

const sees = (staff: Staff, siteId: string | null) => staff.sites === 'all' || (!!siteId && staff.sites.includes(siteId));

export interface DeskDeps {
  sos: SosRepo;
  desk: DeskRepo;
  dispatch: DispatchRepo;
  locator: CrewLocator;
  escalation: EscalationRunner;
  kv: Kv;
  households: HouseholdsRepo;
}

/** An incident this staff member may see. Outside their community looks the same as not existing. */
export async function loadForStaff(d: DeskDeps, staff: Staff, id: string): Promise<DeskIncidentRow | SosFailure> {
  const row = await d.desk.incident(id);
  return row && sees(staff, row.siteId) ? row : fail('not_found', 'No such SOS.');
}

export async function deskView(d: DeskDeps, row: DeskIncidentRow): Promise<DeskIncident> {
  const [events, crew, info] = await Promise.all([
    d.sos.events(row.id),
    crewView(d, row),
    row.crewId && crewActiveStates.includes(row.state) ? d.desk.crewInfo(row.crewId) : null,
  ]);
  return {
    ...toIncident(row, events),
    ref: sosRef(row.id),
    siteId: row.siteId,
    resident: { userId: row.userId, name: row.residentName, community: row.community, tower: row.tower, number: row.number, city: row.city },
    crew: crew && row.crewId ? { ...crew, crewId: row.crewId, name: info?.name ?? null, team: info?.team ?? null } : null,
    closedAt: row.closedAt?.toISOString() ?? null,
    actions: { ...deskActions(row.state), closeNeedsReason: closeNeedsReason(row.state) },
  };
}

export async function deskDetail(d: DeskDeps, row: DeskIncidentRow): Promise<DeskIncidentDetail> {
  const [view, offers] = await Promise.all([deskView(d, row), d.desk.offers(row.id)]);
  return {
    ...view,
    offers: offers.map((o) => ({ crewId: o.crewId, crewName: o.crewName, registration: o.registration, ring: o.ring, offeredAt: o.createdAt.toISOString(), response: o.response })),
  };
}

const asDesk = (staff: Staff) => ({ id: staff.id, role: 'desk' as const });
const forbidden = () => fail('forbidden', 'Your role can watch incidents but not change them.');

/** Cancel (false alarm, resident safe). The escalation run stops. */
export async function deskCancel(d: DeskDeps, staff: Staff, row: IncidentRow, reason: string): Promise<IncidentRow | SosFailure> {
  if (!staff.canAct) return forbidden();
  const next = await move(d.sos, row, 'cancelled', asDesk(staff), reason);
  if (!isSosFailure(next)) await d.escalation.signal(next.id, { kind: 'settled', state: next.state });
  return next;
}

/** Close: after hand-over, or with a reason (treated at home, or 108 took over). */
export async function deskClose(d: DeskDeps, staff: Staff, row: IncidentRow, reason: string | null): Promise<IncidentRow | SosFailure> {
  if (!staff.canAct) return forbidden();
  const next = await move(d.sos, row, 'closed', asDesk(staff), reason);
  if (!isSosFailure(next)) await d.escalation.signal(next.id, { kind: 'settled', state: next.state });
  return next;
}

/** The crew could not mark it themselves (e.g. their phone died). */
export function deskHandOver(d: DeskDeps, staff: Staff, row: IncidentRow, reason: string): Promise<IncidentRow | SosFailure> {
  if (!staff.canAct) return Promise.resolve(forbidden());
  return move(d.sos, row, 'handed_over', asDesk(staff), reason);
}

/**
 * Manual dispatch: offer the job to one crew the desk picked. The crew must be
 * active, on duty and free (and a drill crew for a drill); one who declined
 * earlier can be asked again. Their phone rings like any offer.
 */
export async function deskOffer(d: DeskDeps, staff: Staff, row: IncidentRow, crewId: string): Promise<IncidentRow | SosFailure> {
  if (!staff.canAct) return forbidden();
  if (!deskActions(row.state).offer) return fail('conflict', 'This SOS is not looking for a crew.');
  const free = await d.dispatch.available({ incidentId: row.id, isDrill: row.isDrill, crewIds: [crewId], reoffer: true });
  if (free.length === 0) return fail('conflict', row.isDrill ? 'That crew is not free or does not take part in drills.' : 'That crew is not free (off duty or on another job).');
  const [at, to] = await Promise.all([d.locator.position(crewId), incidentPoint(d.dispatch, row)]);
  await d.dispatch.deskOffer(row.id, crewId, at && to ? estimateEtaS(distanceM(at, to)) : null);
  await d.sos.recordAction(row.id, 'sos_desk_offer', { subject_id: row.userId, drill: row.isDrill, crew_id: crewId, by: staff.id });
  return row;
}

/**
 * Take the job back from its crew (vehicle breakdown, crew cannot reach) and
 * dispatch again from the start: ring 1 now, widen and 108 at the site's
 * thresholds, through a new escalation run. A crew the desk picks is offered
 * at once as well.
 */
export async function deskReassign(d: DeskDeps, staff: Staff, row: IncidentRow, reason: string, crewId?: string): Promise<IncidentRow | SosFailure> {
  if (!staff.canAct) return forbidden();
  const next = await move(d.sos, row, 'dispatching', asDesk(staff), reason);
  if (isSosFailure(next)) return next;
  // The previous crew's accept lock would turn the next accept away for up to two minutes.
  await d.kv.del(acceptLockKey(row.id));
  if (crewId) {
    const offered = await deskOffer(d, staff, next, crewId);
    // The job is back in dispatch either way; a crew that is not free is reported, the nearest crews still get it.
    if (isSosFailure(offered)) console.warn(JSON.stringify({ level: 'warn', event: 'sos_reassign_offer_failed', incidentId: row.id, code: offered.error }));
  }
  await startEscalation(d, next.id);
  return next;
}

/**
 * Test SOS (plan ⚑5): raised by the staff member for a community they cover,
 * located at the community, offered only to drill crews, labelled DRILL
 * everywhere. Never on a resident's account, so a drill can never stand in
 * the way of their real SOS. Pressing again returns the open drill.
 */
export async function testSos(d: DeskDeps, staff: Staff, siteId: string): Promise<{ incident: IncidentRow; created: boolean } | SosFailure> {
  if (!staff.canAct) return forbidden();
  if (!sees(staff, siteId)) return fail('not_found', 'No such community.');
  const site = await d.households.site(siteId);
  if (!site) return fail('not_found', 'No such community.');
  const centre = await d.desk.siteCentre(siteId);
  const result = await raise(d, asDesk(staff), staff.id, { idempotencyKey: randomUUID(), ...(centre ? { location: centre } : {}) }, { isDrill: true, siteId });
  if (result.created) await startEscalation(d, result.incident.id);
  return result;
}
