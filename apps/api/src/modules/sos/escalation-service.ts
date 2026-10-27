// What the escalation workflow does at each stage (docs/plans/phase-3-sos.md §3.5).
// Plain functions over the repo so they are unit-tested without the workflow
// runtime; escalation.ts wraps each one in a durable step.
import type { SosState } from '@repo/contracts/sos';
import type { IncidentRow, SosRepo } from './repo';
import { move, isSosFailure, type SosFailure } from './transition';

/**
 * Side effects of escalation. Step 3 (dispatch) replaces the logging version
 * with Redis GEO offers, console alarms, push and WhatsApp.
 */
export interface SosAlerts {
  /** Offer the job to the next ring of crews (1 = nearest three, 2 = the next ring). Drills go to drill crews only. */
  offerRing(incident: IncidentRow, ring: 1 | 2): Promise<void>;
  /** Alarm the community desk: a new SOS, or nobody has accepted yet (dispatch manually). */
  alertDesk(incident: IncidentRow, why: 'raised' | 'no_accept'): Promise<void>;
  /** Prompt the resident and the desk to call 108. */
  prompt108(incident: IncidentRow): Promise<void>;
}

/** Logs ids only (never health data) until dispatch and notifications land. */
export function logAlerts(): SosAlerts {
  const log = (kind: string, i: IncidentRow, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level: 'info', event: 'sos_alert', kind, incidentId: i.id, drill: i.isDrill, ...extra }));
  return {
    async offerRing(i, ring) {
      log('offer_ring', i, { ring });
    },
    async alertDesk(i, why) {
      log('desk_alarm', i, { why });
    },
    async prompt108(i) {
      log('prompt_108', i);
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
 * thresholds to wait on, or null if the incident is already settled (e.g.
 * cancelled during the countdown to the first step). Safe to retry.
 */
export async function beginDispatch(d: EscalationDeps, id: string): Promise<{ widenAfterS: number; escalateAfterS: number } | null> {
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
  return { widenAfterS: incident.widenAfterS, escalateAfterS: incident.escalateAfterS };
}

/** No accept by the first threshold: widen to ring 2 and ask the desk to dispatch manually. False if already settled. */
export async function widenDispatch(d: EscalationDeps, id: string): Promise<boolean> {
  const incident = await d.sos.get(id);
  if (incident?.state !== 'dispatching') return false;
  await d.alerts.offerRing(incident, 2);
  await d.alerts.alertDesk(incident, 'no_accept');
  await record(d, incident, 'sos_offer_ring', { ring: 2 });
  return true;
}

/** No accept by the second threshold: mark escalated_to_108 and prompt a 108 call. Dispatch continues. False if already settled. */
export async function escalateTo108(d: EscalationDeps, id: string): Promise<boolean> {
  const incident = await d.sos.get(id);
  if (incident?.state !== 'dispatching') return false;
  const moved = await move(d.sos, incident, 'escalated_to_108', { id: null, role: 'system' }, `No crew accepted within ${incident.escalateAfterS} s`);
  if (isSosFailure(moved)) return false;
  await d.alerts.prompt108(moved);
  return true;
}

/**
 * A crew takes the job. The compare-and-set in the repo means exactly one of
 * several simultaneous accepts wins (step 3 adds a Redis lock in front).
 */
export async function acceptForCrew(d: { sos: SosRepo; escalation: EscalationRunner }, id: string, crewId: string): Promise<IncidentRow | SosFailure> {
  const incident = await d.sos.get(id);
  if (!incident) return { error: 'not_found', message: 'No such SOS.' };
  if (incident.state !== 'dispatching' && incident.state !== 'escalated_to_108') return { error: 'conflict', message: 'This job has been taken or closed.' };
  const accepted = await move(d.sos, incident, 'accepted', { id: null, role: 'system' }, null, { crewId });
  if (isSosFailure(accepted)) return accepted;
  await d.escalation.signal(id, { kind: 'settled', state: 'accepted' });
  return accepted;
}
