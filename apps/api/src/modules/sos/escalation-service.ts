// What the escalation workflow does at each stage (docs/plans/phase-3-sos.md §3.5).
// Plain functions over the repo so they are unit-tested without the workflow
// runtime; escalation.ts wraps each one in a durable step.
import type { SosState } from '@repo/contracts/sos';
import type { IncidentRow, SosRepo } from './repo';
import { move, isSosFailure, type SosFailure } from './transition';

/**
 * Side effects of escalation (plan §11): offers in rings, and desk alarms.
 * Ring 1 = the place's primary team (topped up with the nearest crews), ring 2.. =
 * its backup teams in order, then the nearest free crews. No 108 step.
 */
export interface SosAlerts {
  /** Offer the job to the given ring. Drills go to drill crews only. */
  offerRing(incident: IncidentRow, ring: number): Promise<void>;
  /** Alarm the command center and admins: a new SOS, or the previous ring went unanswered and this one is being offered. */
  alertDesk(incident: IncidentRow, why: 'raised' | 'no_accept', ring?: number): Promise<void>;
}

/** Logs ids only (never health data). */
export function logAlerts(): SosAlerts {
  const log = (kind: string, i: IncidentRow, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: 'info', event: 'sos_alert', kind, incidentId: i.id, drill: i.isDrill, ...extra }));
  return {
    async offerRing(i, ring) {
      log('offer_ring', i, { ring });
    },
    async alertDesk(i, why, ring) {
      log('desk_alarm', i, { why, ring });
    },
  };
}

export interface EscalationDeps {
  sos: SosRepo;
  alerts: SosAlerts;
}

/** Sent to a running escalation when the incident no longer needs it (a crew accepted, or it was cancelled or closed). */
export type EscalationSignal = { kind: 'settled'; state: SosState };
/** Deterministic, so the API can reach the run from the incident id alone. */
export const escalationToken = (incidentId: string) => `sos-escalation:${incidentId}`;

/** Starts and signals escalation runs. The workflow version lives in escalation-runner.ts; tests use a fake. */
export interface EscalationRunner {
  start(incidentId: string): Promise<string>;
  /** Never throws: a run that already finished needs no signal. */
  signal(incidentId: string, signal: EscalationSignal): Promise<void>;
}

const record = (d: EscalationDeps, i: IncidentRow, action: string, metadata: Record<string, unknown> = {}) =>
  d.sos.recordAction(i.id, action, { subject_id: i.userId, drill: i.isDrill, ...metadata });

/**
 * raised → dispatching, alarm the desk and offer ring 1. Returns the
 * time to wait between rings, or null if the incident is already settled (e.g.
 * cancelled during the countdown to the first step). Safe to retry.
 */
export async function beginDispatch(d: EscalationDeps, id: string): Promise<{ ringAfterS: number } | null> {
  let incident = await d.sos.get(id);
  if (!incident) return null;
  if (incident.state === 'raised') {
    const moved = await move(d.sos, incident, 'dispatching', { id: null, role: 'system' }, null);
    if (isSosFailure(moved)) return null;
    incident = moved;
  } else if (incident.state !== 'dispatching') {
    return null;
  }
  await d.alerts.alertDesk(incident, 'raised');
  await d.alerts.offerRing(incident, 1);
  await record(d, incident, 'sos_offer_ring', { ring: 1 });
  return { ringAfterS: incident.widenAfterS };
}

/**
 * Nobody accepted the previous ring in time: alarm the desk and admins, and offer
 * the next ring (the next backup team, then the nearest free crews). Earlier
 * offers stay open. False if already settled.
 */
export async function nextRing(d: EscalationDeps, id: string, ring: number): Promise<boolean> {
  const incident = await d.sos.get(id);
  if (incident?.state !== 'dispatching') return false;
  await d.alerts.alertDesk(incident, 'no_accept', ring);
  await d.alerts.offerRing(incident, ring);
  await record(d, incident, 'sos_offer_ring', { ring });
  return true;
}

/**
 * A crew takes the job. The compare-and-set in the repo means exactly one of
 * several simultaneous accepts wins (step 3 adds a Redis lock in front).
 */
export async function acceptForCrew(d: { sos: SosRepo; escalation: EscalationRunner }, id: string, crewId: string): Promise<IncidentRow | SosFailure> {
  const incident = await d.sos.get(id);
  if (!incident) return { error: 'not_found', message: 'No such SOS.' };
  if (incident.state !== 'dispatching') return { error: 'conflict', message: 'This job has been taken or closed.' };
  const accepted = await move(d.sos, incident, 'accepted', { id: null, role: 'system' }, null, { crewId });
  if (isSosFailure(accepted)) return accepted;
  await d.escalation.signal(id, { kind: 'settled', state: 'accepted' });
  return accepted;
}
