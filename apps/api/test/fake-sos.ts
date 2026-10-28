import { randomUUID } from 'node:crypto';
import { crewActiveStates } from '@repo/contracts/sos';
import type { EventRow, IncidentRow, SosRepo } from '../src/modules/sos/repo';
import type { EscalationRunner, EscalationSignal, SosAlerts } from '../src/modules/sos/escalation-service';

/** Records escalation starts and signals instead of running the workflow. */
export function fakeEscalation(opts: { startFails?: boolean } = {}) {
  const started: string[] = [];
  const signals: { incidentId: string; signal: EscalationSignal }[] = [];
  const runner: EscalationRunner = {
    async start(incidentId) {
      if (opts.startFails) throw new Error('workflow unavailable');
      started.push(incidentId);
      return `run-${started.length}`;
    },
    async signal(incidentId, signal) {
      signals.push({ incidentId, signal });
    },
  };
  return { runner, started, signals };
}

/** Records what escalation asked for (offers, desk alarms, 108 prompts). */
export function recordingAlerts() {
  const sent: { kind: 'offer_ring' | 'desk_alarm' | 'prompt_108'; incidentId: string; detail?: string | number }[] = [];
  const alerts: SosAlerts = {
    async offerRing(i, ring) {
      sent.push({ kind: 'offer_ring', incidentId: i.id, detail: ring });
    },
    async alertDesk(i, why) {
      sent.push({ kind: 'desk_alarm', incidentId: i.id, detail: why });
    },
    async prompt108(i) {
      sent.push({ kind: 'prompt_108', incidentId: i.id });
    },
  };
  return { alerts, sent };
}

/** In-memory SosRepo mirroring the database rules (one open incident per person, CAS transitions). */
export function fakeSos() {
  const incidents: (IncidentRow & { idempotencyKey: string })[] = [];
  const events = new Map<string, EventRow[]>();
  const settings = new Map<string, { widenAfterS: number; escalateAfterS: number }>();
  const audit: { incidentId: string; action: string; role: string }[] = [];
  const runs = new Map<string, string>();
  let clock = Date.parse('2026-10-27T10:00:00Z');
  const now = () => new Date((clock += 1000));
  const strip = ({ idempotencyKey: _k, ...r }: IncidentRow & { idempotencyKey: string }): IncidentRow => ({ ...r });
  const isOpen = (s: string) => s !== 'closed' && s !== 'cancelled';

  const repo: SosRepo = {
    async siteSettings(siteId) {
      return settings.get(siteId) ?? null;
    },
    async byIdempotency(raisedBy, key) {
      const r = incidents.find((i) => i.raisedBy === raisedBy && i.idempotencyKey === key);
      return r ? strip(r) : null;
    },
    async openForUser(userId) {
      const r = incidents.find((i) => i.userId === userId && isOpen(i.state));
      return r ? strip(r) : null;
    },
    async activeForCrew(crewId) {
      const r = incidents.find((i) => i.crewId === crewId && crewActiveStates.includes(i.state));
      return r ? strip(r) : null;
    },
    async create(n) {
      if (incidents.some((i) => i.userId === n.userId && isOpen(i.state))) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      const row = {
        id: randomUUID(),
        userId: n.userId,
        householdId: n.householdId,
        siteId: n.siteId,
        raisedBy: n.raisedBy,
        idempotencyKey: n.idempotencyKey,
        state: 'raised' as const,
        isDrill: n.isDrill,
        lat: n.lat,
        lng: n.lng,
        accuracyM: n.accuracyM,
        widenAfterS: n.widenAfterS,
        escalateAfterS: n.escalateAfterS,
        crewId: null,
        createdAt: now(),
      };
      incidents.push(row);
      events.set(row.id, [{ createdAt: row.createdAt, fromState: null, toState: 'raised', actorRole: n.raisedByRole, reason: null }]);
      audit.push({ incidentId: row.id, action: 'sos_raised', role: n.raisedByRole });
      return strip(row);
    },
    async get(id) {
      const r = incidents.find((i) => i.id === id);
      return r ? strip(r) : null;
    },
    async events(id) {
      return events.get(id) ?? [];
    },
    async transition(id, from, to, actor, reason, assign) {
      const r = incidents.find((i) => i.id === id);
      if (!r || r.state !== from) return null;
      r.state = to;
      if (assign) r.crewId = assign.crewId;
      events.get(id)!.push({ createdAt: now(), fromState: from, toState: to, actorRole: actor.role, reason });
      audit.push({ incidentId: id, action: `sos_${to}`, role: actor.role });
      return strip(r);
    },
    async setWorkflowRun(id, runId) {
      runs.set(id, runId);
    },
    async recordAction(id, action) {
      audit.push({ incidentId: id, action, role: 'system' });
    },
  };
  return { repo, incidents, events, settings, audit, runs };
}
