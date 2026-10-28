// Live updates on the incident's private channel `sos:{id}` (plan §3.6, §4).
// Payloads carry ids, states and positions only, never medical details.
import { sosTopic, type Realtime } from '../../lib/realtime';
import type { SosRepo } from './repo';

/**
 * Every successful state change, wherever it happens (resident, crew, desk or
 * the escalation workflow), is pushed as `state` so the resident app and the
 * console refetch at once instead of waiting for their next poll.
 */
export function publishingSosRepo(repo: SosRepo, realtime: Realtime): SosRepo {
  return {
    ...repo,
    async transition(id, from, to, actor, reason, assign) {
      const next = await repo.transition(id, from, to, actor, reason, assign);
      if (next) await realtime.publish(sosTopic(id), 'state', { state: next.state, from, by: actor.role, at: new Date().toISOString() });
      return next;
    },
  };
}

/** The ambulance moved: pushed as `position` for the live map and distance. */
export function publishCrewPosition(realtime: Realtime, incidentId: string, at: { lat: number; lng: number; at: string }) {
  return realtime.publish(sosTopic(incidentId), 'position', { lat: at.lat, lng: at.lng, at: at.at });
}
