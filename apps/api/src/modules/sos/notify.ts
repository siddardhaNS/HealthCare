// One durable run per real SOS (plan §13): WhatsApp alerts now, then after
// ALERT_SMS_AFTER_S an SMS for any not delivered or read. Inputs are ids only.
import { sleep } from 'workflow';
import { start } from 'workflow/api';
// Types only at the top: the workflow bundle must not pull in the database driver.
// Steps load the alerts module when they run (in Node, outside the workflow sandbox).
import type { SosNotifyDeps, SosNotifyRunner } from './alerts';

/** Matches ALERT_SMS_AFTER_S in ./alerts (kept here so the workflow bundle stays free of it). */
const SMS_AFTER_S = 60;

export async function sosNotify(incidentId: string): Promise<number> {
  'use workflow';
  await sendStep(incidentId);
  await sleep(`${SMS_AFTER_S}s`);
  return fallbackStep(incidentId);
}

async function sendStep(incidentId: string) {
  'use step';
  const { sendSosAlerts } = await import('./alerts');
  await sendSosAlerts(await stepDeps(), incidentId);
}

async function fallbackStep(incidentId: string) {
  'use step';
  const { sendSosAlertFallback } = await import('./alerts');
  return sendSosAlertFallback(await stepDeps(), incidentId);
}

/** Workflow tests install fakes under this key, as for escalation. */
export const NOTIFY_DEPS = Symbol.for('api.sos.notifyDeps');
const SHARED = Symbol.for('api.sos.sharedNotifyDeps');

async function stepDeps(): Promise<SosNotifyDeps> {
  const g = globalThis as Record<symbol, SosNotifyDeps | undefined>;
  if (g[NOTIFY_DEPS]) return g[NOTIFY_DEPS];
  if (!g[SHARED]) {
    const { depsFromEnv } = await import('../../deps');
    const deps = depsFromEnv();
    g[SHARED] = { sos: deps.sos, consents: deps.consents, sosAlertsRepo: deps.sosAlertsRepo, messaging: deps.messaging };
  }
  return g[SHARED];
}

export function workflowNotify(): SosNotifyRunner {
  return {
    async start(incidentId) {
      await start(sosNotify, [incidentId]);
    },
  };
}
