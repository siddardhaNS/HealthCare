import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { acceptForCrew, beginDispatch, nextRing } from '../src/modules/sos/escalation-service';
import { raise } from '../src/modules/sos/service';
import { fakeEscalation, fakeSos, recordingAlerts } from './fake-sos';
import { fakeHouseholds } from './fake-households';
import { testContext } from './helpers';

const MOM = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const CREW_A = 'c0000000-0000-4000-8000-00000000000a';
const CREW_B = 'c0000000-0000-4000-8000-00000000000b';

async function setup() {
  const sos = fakeSos();
  const { alerts, sent } = recordingAlerts();
  const escalation = fakeEscalation();
  const { incident } = await raise({ sos: sos.repo, households: fakeHouseholds([]).repo }, { id: MOM, role: 'resident' }, MOM, { idempotencyKey: randomUUID() });
  const d = { sos: sos.repo, alerts, escalation: escalation.runner };
  return { d, sos, sent, escalation, id: incident.id };
}

describe('escalation stages', () => {
  it('begins dispatch: raised → dispatching, desk alarm, ring 1, waiting the community’s timeout between rings', async () => {
    const { d, sos, sent, id } = await setup();
    expect(await beginDispatch(d, id)).toEqual({ ringAfterS: 30 });
    expect(sos.incidents[0]!.state).toBe('dispatching');
    expect(sent).toEqual([
      { kind: 'desk_alarm', incidentId: id, detail: 'raised' },
      { kind: 'offer_ring', incidentId: id, detail: 1 },
    ]);
    expect(sos.events.get(id)!.at(-1)).toMatchObject({ fromState: 'raised', toState: 'dispatching', actorRole: 'system' });
    expect(sos.audit.map((a) => a.action)).toContain('sos_offer_ring');
  });

  it('a retried first step continues from dispatching instead of failing', async () => {
    const { d, id } = await setup();
    await beginDispatch(d, id);
    expect(await beginDispatch(d, id)).toEqual({ ringAfterS: 30 });
  });

  it('does nothing when the SOS was cancelled before dispatch began', async () => {
    const { d, sos, sent, id } = await setup();
    sos.incidents[0]!.state = 'cancelled';
    expect(await beginDispatch(d, id)).toBeNull();
    expect(sent).toEqual([]);
  });

  it('no accept in time: alarms the desk and admins, then offers the next ring (plan §11)', async () => {
    const { d, sent, id } = await setup();
    await beginDispatch(d, id);
    expect(await nextRing(d, id, 2)).toBe(true);
    expect(await nextRing(d, id, 3)).toBe(true);
    expect(sent.slice(2)).toEqual([
      { kind: 'desk_alarm', incidentId: id, detail: 'no_accept' },
      { kind: 'offer_ring', incidentId: id, detail: 2 },
      { kind: 'desk_alarm', incidentId: id, detail: 'no_accept' },
      { kind: 'offer_ring', incidentId: id, detail: 3 },
    ]);
  });

  it('never moves the SOS to a 108 state', async () => {
    const { d, sos, id } = await setup();
    await beginDispatch(d, id);
    for (let ring = 2; ring <= 5; ring++) await nextRing(d, id, ring);
    expect(sos.incidents[0]!.state).toBe('dispatching');
    expect(sos.events.get(id)!.map((e) => e.toState)).not.toContain('escalated_to_108');
  });

  it('offers no further ring once a crew has accepted', async () => {
    const { d, sent, id } = await setup();
    await beginDispatch(d, id);
    await acceptForCrew(d, id, CREW_A);
    expect(await nextRing(d, id, 2)).toBe(false);
    expect(sent.map((s) => s.kind)).not.toContain('desk_alarm:no_accept');
    expect(sent.filter((s) => s.kind === 'offer_ring')).toHaveLength(1);
  });
});

describe('a crew accepting', () => {
  it('assigns the crew and tells the escalation run to stop', async () => {
    const { d, sos, escalation, id } = await setup();
    await beginDispatch(d, id);
    const res = await acceptForCrew(d, id, CREW_A);
    expect(res).toMatchObject({ state: 'accepted', crewId: CREW_A });
    expect(escalation.signals).toEqual([{ incidentId: id, signal: { kind: 'settled', state: 'accepted' } }]);
    expect(sos.audit.at(-1)).toMatchObject({ action: 'sos_accepted' });
  });

  it('still works several rings later', async () => {
    const { d, id } = await setup();
    await beginDispatch(d, id);
    await nextRing(d, id, 2);
    await nextRing(d, id, 3);
    expect(await acceptForCrew(d, id, CREW_A)).toMatchObject({ state: 'accepted', crewId: CREW_A });
  });

  it('two crews accepting at the same moment: exactly one wins', async () => {
    const { d, sos, id } = await setup();
    await beginDispatch(d, id);
    const [a, b] = await Promise.all([acceptForCrew(d, id, CREW_A), acceptForCrew(d, id, CREW_B)]);
    const winners = [a, b].filter((r) => 'state' in r);
    expect(winners).toHaveLength(1);
    expect([a, b].find((r) => 'error' in r)).toMatchObject({ error: 'conflict' });
    expect(sos.events.get(id)!.filter((e) => e.toState === 'accepted')).toHaveLength(1);
  });

  it('cannot take a cancelled SOS', async () => {
    const { d, sos, id } = await setup();
    sos.incidents[0]!.state = 'cancelled';
    expect(await acceptForCrew(d, id, CREW_A)).toMatchObject({ error: 'conflict' });
  });
});

describe('the SOS routes and the escalation run', () => {
  const headers = async (t: Awaited<ReturnType<typeof testContext>>) => ({ authorization: `Bearer ${await t.token({ sub: MOM })}`, 'content-type': 'application/json' });

  it('a new SOS starts one run and records its id; retries start none', async () => {
    const t = await testContext();
    const h = await headers(t);
    const body = JSON.stringify({ idempotencyKey: randomUUID() });
    const res = await t.app.request('/v1/sos', { method: 'POST', headers: h, body });
    const { id } = (await res.json()) as { id: string };
    await t.app.request('/v1/sos', { method: 'POST', headers: h, body });
    expect(t.escalation.started).toEqual([id]);
    expect(t.sos.runs.get(id)).toBe('run-1');
  });

  it('the SOS is still raised (201) when the run cannot start', async () => {
    const t = await testContext({ escalationFails: true });
    const res = await t.app.request('/v1/sos', { method: 'POST', headers: await headers(t), body: JSON.stringify({ idempotencyKey: randomUUID() }) });
    expect(res.status).toBe(201);
    expect(t.sos.incidents).toHaveLength(1);
  });

  it('cancelling signals the run to stop', async () => {
    const t = await testContext();
    const h = await headers(t);
    const { id } = (await (await t.app.request('/v1/sos', { method: 'POST', headers: h, body: JSON.stringify({ idempotencyKey: randomUUID() }) })).json()) as { id: string };
    await t.app.request(`/v1/sos/${id}/cancel`, { method: 'POST', headers: h, body: JSON.stringify({}) });
    expect(t.escalation.signals).toEqual([{ incidentId: id, signal: { kind: 'settled', state: 'cancelled' } }]);
  });
});
