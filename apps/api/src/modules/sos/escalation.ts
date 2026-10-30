// One durable run per SOS: offer, wait, widen at the first threshold, prompt
// 108 at the second, and stop as soon as the incident settles. Sleeps survive
// crashes and redeploys (Vercel Workflows). Inputs are ids only, never health data.
import { createHook, sleep } from 'workflow';
import { beginDispatch, escalateTo108, escalationToken, widenDispatch, type EscalationDeps, type EscalationSignal } from './escalation-service';

/** After the 108 prompt, dispatch stays open for a crew to accept for this long; the desk closes it in the console. */
export const OPEN_AFTER_108_S = 2 * 60 * 60;

export type EscalationOutcome = 'settled_before_dispatch' | 'settled_before_widen' | 'settled_after_widen' | 'settled_after_108' | 'open_after_108';

export async function sosEscalation(incidentId: string): Promise<EscalationOutcome> {
  'use workflow';
  // Created first so a signal is never missed; every step also re-reads the state.
  const hook = createHook<EscalationSignal>({ token: escalationToken(incidentId) });
  const settled = hook.then((s) => s);
  const timeout = (seconds: number) => sleep(`${seconds}s`).then(() => null);

  const plan = await beginDispatchStep(incidentId);
  if (!plan) return 'settled_before_dispatch';

  if (await Promise.race([settled, timeout(plan.widenAfterS)])) return 'settled_before_widen';
  if (!(await widenStep(incidentId))) return 'settled_before_widen';

  if (await Promise.race([settled, timeout(plan.escalateAfterS - plan.widenAfterS)])) return 'settled_after_widen';
  if (!(await escalateStep(incidentId))) return 'settled_after_widen';

  // Dispatch continues after the 108 prompt (a crew may still accept).
  return (await Promise.race([settled, timeout(OPEN_AFTER_108_S)])) ? 'settled_after_108' : 'open_after_108';
}

async function beginDispatchStep(incidentId: string) {
  'use step';
  return beginDispatch(await stepDeps(), incidentId);
}

async function widenStep(incidentId: string) {
  'use step';
  return widenDispatch(await stepDeps(), incidentId);
}

async function escalateStep(incidentId: string) {
  'use step';
  return escalateTo108(await stepDeps(), incidentId);
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
