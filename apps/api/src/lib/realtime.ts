// Server → app pushes over Supabase Realtime Broadcast (plan §4: private
// channels per incident). Sent through the REST endpoint, so the stateless
// API never holds a socket:
// https://supabase.com/docs/guides/realtime/broadcast (checked 2026-10-28).
// Who may listen is decided by RLS on realtime.messages (migration
// …_sos_realtime.sql). Pushes only speed the apps up: they also poll, so a
// lost push is never a lost update.

export interface Realtime {
  /** Fire and forget: never throws, never waits longer than a moment. */
  publish(topic: string, event: string, payload: Record<string, unknown>): Promise<void>;
}

export const sosTopic = (incidentId: string) => `sos:${incidentId}`;

const PUBLISH_TIMEOUT_MS = 2_000;

export function supabaseRealtime(opts: { supabaseUrl: string; secretKey: string; fetch?: typeof fetch }): Realtime {
  const base = opts.supabaseUrl.replace(/\/$/, '');
  const doFetch = opts.fetch ?? fetch;
  return {
    async publish(topic, event, payload) {
      try {
        const res = await doFetch(`${base}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/${encodeURIComponent(event)}?private=true`, {
          method: 'POST',
          headers: { apikey: opts.secretKey, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
        });
        if (!res.ok) console.warn(JSON.stringify({ level: 'warn', event: 'realtime_publish_failed', topic, status: res.status }));
      } catch (err) {
        console.warn(JSON.stringify({ level: 'warn', event: 'realtime_publish_failed', topic, name: (err as Error).name }));
      }
    },
  };
}

/** No secret key (tests, or a local stack without one): nothing is pushed; apps fall back to polling. */
export function silentRealtime(): Realtime {
  return { async publish() {} };
}

/** Tests: remembers what was published. */
export function recordingRealtime() {
  const sent: { topic: string; event: string; payload: Record<string, unknown> }[] = [];
  const realtime: Realtime = {
    async publish(topic, event, payload) {
      sent.push({ topic, event, payload });
    },
  };
  return { realtime, sent };
}
