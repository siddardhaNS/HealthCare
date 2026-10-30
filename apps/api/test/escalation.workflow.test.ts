// Whole escalation runs on the Workflow runtime, with simulated crews.
// Sleeps are fast-forwarded with wakeUp, so the 30 s timeouts cost nothing here.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getRun } from 'workflow/api';
import { waitForHook, waitForSleep } from '@workflow/vitest';
import { ESCALATION_DEPS } from '../src/modules/sos/escalation';
import { workflowEscalation } from '../src/modules/sos/escalation-runner';
import { acceptForCrew, escalationToken } from '../src/modules/sos/escalation-service';
import { move, raise } from '../src/modules/sos/service';
import type { IncidentRow } from '../src/modules/sos/repo';
import { fakeSos, recordingAlerts } from './fake-sos';
import { fakeHouseholds } from './fake-households';

const MOM = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const CREWS = ['c0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000c'];

let sos: ReturnType<typeof fakeSos>;
let sent: ReturnType<typeof recordingAlerts>['sent'];
const runner = workflowEscalation();

beforeEach(() => {
  sos = fakeSos();
  const rec = recordingAlerts();
  sent = rec.sent;
  (globalThis as Record<symbol, unknown>)[ESCALATION_DEPS] = { sos: sos.repo, alerts: rec.alerts };
});

async function raiseAndStart() {
  const { incident } = await raise({ sos: sos.repo, households: fakeHouseholds([]).repo }, { id: MOM, role: 'resident' }, MOM, { idempotencyKey: randomUUID() });
  const run = getRun<string>(await runner.start(incident.id));
  // Ready once the hook exists and dispatch has begun (the first sleep is pending).
  await waitForHook(run, { token: escalationToken(incident.id) });
  const firstSleep = await waitForSleep(run);
  return { id: incident.id, run, firstSleep };
}

/** A simulated crew answering an offer: the same call the accept endpoint makes. */
const crewAccepts = (id: string, crew: string) => acceptForCrew({ sos: sos.repo, escalation: runner }, id, crew);
const state = (id: string) => sos.incidents.find((i) => i.id === id)!.state;
const kinds = (id: string) => sent.filter((s) => s.incidentId === id).map((s) => `${s.kind}:${s.detail ?? ''}`);

describe('SOS escalation workflow', () => {
  it('a crew accepts before 30 s: no alarm, no second ring', async () => {
    const { id, run } = await raiseAndStart();
    expect(state(id)).toBe('dispatching');
    expect(await crewAccepts(id, CREWS[0]!)).toMatchObject({ state: 'accepted', crewId: CREWS[0] });
    expect(await run.returnValue).toBe('settled_in_ring_1');
    expect(kinds(id)).toEqual(['desk_alarm:raised', 'offer_ring:1']);
  });

  it('nobody accepts: at every 30 s the desk is alarmed and the next ring is offered; never 108', async () => {
    const { id, run, firstSleep } = await raiseAndStart();
    await run.wakeUp({ correlationIds: [firstSleep] });
    const secondSleep = await waitForSleep(run);
    expect(kinds(id)).toEqual(['desk_alarm:raised', 'offer_ring:1', 'desk_alarm:no_accept', 'offer_ring:2']);
    await run.wakeUp({ correlationIds: [secondSleep] });
    await waitForSleep(run);
    expect(kinds(id).slice(-2)).toEqual(['desk_alarm:no_accept', 'offer_ring:3']);
    expect(state(id)).toBe('dispatching');
    expect(sos.events.get(id)!.map((e) => e.toState)).toEqual(['raised', 'dispatching']);
  });

  it('a crew from an earlier ring can still accept later, and the run ends', async () => {
    const { id, run, firstSleep } = await raiseAndStart();
    await run.wakeUp({ correlationIds: [firstSleep] });
    await run.wakeUp({ correlationIds: [await waitForSleep(run)] });
    await waitForSleep(run);
    await crewAccepts(id, CREWS[1]!);
    expect(await run.returnValue).toBe('settled_after_more_rings');
    expect(state(id)).toBe('accepted');
  });

  it('the resident cancels during dispatch: the run stops without escalating', async () => {
    const { id, run } = await raiseAndStart();
    const cancelled = await move(sos.repo, sos.incidents.find((i) => i.id === id)! as IncidentRow, 'cancelled', { id: MOM, role: 'resident' }, null);
    expect(cancelled).toMatchObject({ state: 'cancelled' });
    await runner.signal(id, { kind: 'settled', state: 'cancelled' });
    expect(await run.returnValue).toBe('settled_in_ring_1');
    expect(kinds(id)).not.toContain('desk_alarm:no_accept');
  });

  it('three crews accept at once: exactly one wins and the run ends once', async () => {
    const { id, run } = await raiseAndStart();
    const results = await Promise.all(CREWS.map((c) => crewAccepts(id, c)));
    expect(results.filter((r) => 'state' in r)).toHaveLength(1);
    expect(await run.returnValue).toBe('settled_in_ring_1');
    expect(sos.events.get(id)!.filter((e) => e.toState === 'accepted')).toHaveLength(1);
  });

  it('the desk reassigns after an accept: a second run for the same incident dispatches again from ring 1', async () => {
    const { id, run } = await raiseAndStart();
    await crewAccepts(id, CREWS[0]!);
    expect(await run.returnValue).toBe('settled_in_ring_1');
    await move(sos.repo, sos.incidents.find((i) => i.id === id)! as IncidentRow, 'dispatching', { id: null, role: 'desk' }, 'Ambulance broke down');

    const again = getRun<string>(await runner.start(id));
    await waitForHook(again, { token: escalationToken(id) });
    const sleep = await waitForSleep(again);
    expect(kinds(id).slice(-2)).toEqual(['desk_alarm:raised', 'offer_ring:1']);
    await again.wakeUp({ correlationIds: [sleep] });
    await waitForSleep(again);
    expect(kinds(id).at(-1)).toBe('desk_alarm:no_accept');
    // The new run hears the next accept.
    await crewAccepts(id, CREWS[1]!);
    expect(await again.returnValue).toBe('settled_after_more_rings');
  });

  it('a missed signal is harmless: the timer step sees the accept and stops', async () => {
    const { id, run, firstSleep } = await raiseAndStart();
    // Accept without signalling the run (e.g. the signal was lost).
    await acceptForCrew({ sos: sos.repo, escalation: { start: async () => '', signal: async () => {} } }, id, CREWS[2]!);
    await run.wakeUp({ correlationIds: [firstSleep] });
    expect(await run.returnValue).toBe('settled_in_ring_1');
    expect(kinds(id)).not.toContain('offer_ring:2');
  });
});
