// Live updates on the incident's private channel `sos:{id}` and the console's
// desk channels `desk:{siteId}` / `desk:all` (plan §3.6, §4).
// Payloads carry ids, states and positions only, never medical details.
import { deskAllTopic, deskTopic, sosTopic, type Realtime } from '../../lib/realtime';
import type { IncidentRow, SosRepo } from './repo';

type Where = Pick<IncidentRow, 'id' | 'siteId' | 'isDrill'>;

/** To the command center: the incident's community desk and operations. */
export async function publishDesk(realtime: Realtime, i: Where, event: string, payload: Record<string, unknown>) {
  const body = { incidentId: i.id, drill: i.isDrill, ...payload };
  await Promise.all([...(i.siteId ? [deskTopic(i.siteId)] : []), deskAllTopic].map((t) => realtime.publish(t, event, body)));
}

/**
 * Every successful state change, wherever it happens (resident, crew, desk or
 * the escalation workflow), is pushed as `state` so the resident app and the
 * console refetch at once instead of waiting for their next poll.
 */
export function publishingSosRepo(repo: SosRepo, realtime: Realtime): SosRepo {
  return {
    ...repo,
    async create(n) {
      const row = await repo.create(n);
      await publishDesk(realtime, row, 'state', { state: row.state, from: null, at: new Date().toISOString() });
      return row;
    },
    async transition(id, from, to, actor, reason, assign) {
      const next = await repo.transition(id, from, to, actor, reason, assign);
      if (next) {
        const at = new Date().toISOString();
        await Promise.all([
          realtime.publish(sosTopic(id), 'state', { state: next.state, from, by: actor.role, at }),
          publishDesk(realtime, next, 'state', { state: next.state, from, at }),
        ]);
      }
      return next;
    },
  };
}

/** The ambulance moved: pushed as `position` for the live maps and distance. */
export function publishCrewPosition(realtime: Realtime, incident: Where, at: { lat: number; lng: number; at: string }) {
  const p = { lat: at.lat, lng: at.lng, at: at.at };
  return Promise.all([realtime.publish(sosTopic(incident.id), 'position', p), publishDesk(realtime, incident, 'position', p)]).then(() => undefined);
}
