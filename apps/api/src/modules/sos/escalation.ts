// One durable run per SOS (plan §11): offer the primary team, then at every
// timeout alarm the desk and offer the next ring (backup teams in order, then
// the nearest free crews), and stop as soon as the incident settles. No 108
// step. Sleeps survive crashes and redeploys (Vercel Workflows). Inputs are
// ids only, never health data.
import { createHook, sleep } from 'workflow';
import { beginDispatch, escalationToken, nextRing, type EscalationDeps, type EscalationSignal } from './escalation-service';

/** Rings offered automatically (about 10 min at 30 s); after that the desk keeps dispatching by hand. */
export const MAX_RINGS = 20;
/** After the last ring the run waits this long for a late accept before it ends; the desk closes the incident. */
export const OPEN_AFTER_RINGS_S = 2 * 60 * 60;

export type EscalationOutcome = 'settled_before_dispatch' | 'settled_in_ring_1' | 'settled_after_more_rings' | 'open_after_rings';

export async function sosEscalation(incidentId: string): Promise<EscalationOutcome> {
  'use workflow';
  // Created first so a signal is never missed; every step also re-reads the state.
  const hook = createHook<EscalationSignal>({ token: escalationToken(incidentId) });
  const settled = hook.then((s) => s);
  const timeout = (seconds: number) => sleep(`${seconds}s`).then(() => null);

  const plan = await beginDispatchStep(incidentId);
  if (!plan) return 'settled_before_dispatch';

  for (let ring = 2; ring <= MAX_RINGS; ring++) {
    if (await Promise.race([settled, timeout(plan.ringAfterS)])) return ring === 2 ? 'settled_in_ring_1' : 'settled_after_more_rings';
    if (!(await nextRingStep(incidentId, ring))) return ring === 2 ? 'settled_in_ring_1' : 'settled_after_more_rings';
  }
  return (await Promise.race([settled, timeout(OPEN_AFTER_RINGS_S)])) ? 'settled_after_more_rings' : 'open_after_rings';
}

async function beginDispatchStep(incidentId: string) {
  'use step';
  return beginDispatch(await stepDeps(), incidentId);
}

async function nextRingStep(incidentId: string, ring: number) {
  'use step';
  return nextRing(await stepDeps(), incidentId, ring);
}

/**
 * Steps run outside the request, so they build their own dependencies.
 * Workflow tests install fakes under this key (vi.mock cannot reach step bundles).
 */
export const ESCALATION_DEPS = Symbol.for('api.sos.escalationDeps');

/** One set per process: building deps opens a database pool, and a pool per step exhausted Postgres under load. */
const SHARED_STEP_DEPS = Symbol.for('api.sos.sharedStepDeps');

async function stepDeps(): Promise<EscalationDeps> {
  const g = globalThis as Record<symbol, EscalationDeps | undefined>;
  const injected = g[ESCALATION_DEPS];
  if (injected) return injected;
  if (!g[SHARED_STEP_DEPS]) {
    const { depsFromEnv } = await import('../../deps');
    const deps = depsFromEnv();
    g[SHARED_STEP_DEPS] = { sos: deps.sos, alerts: deps.sosAlerts };
  }
  return g[SHARED_STEP_DEPS];
}
