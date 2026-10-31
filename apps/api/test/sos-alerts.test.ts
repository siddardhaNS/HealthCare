import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { purposeMeta } from '@repo/contracts';
import { sendSosAlertFallback, sendSosAlerts } from '../src/modules/sos/alerts';
import { testContext } from './helpers';

const A = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const DESK = '22222222-2222-4222-8222-222222222222';
const HOME = { lat: 17.44, lng: 78.35 };

/** Lakshmi (A) in Green Meadows with three emergency contacts: one agreed, one not, one agreed who later replied STOP. */
async function setup(opts: { familyAlerts?: boolean } = {}) {
  const t = await testContext();
  const green = t.hh.addSite({ name: 'Green Meadows', kind: 'apartment', city: 'Hyderabad', joinCode: 'GREEN24', homes: [{ tower: 'B', number: '1204' }] });
  await t.hh.repo.createHousehold({ homeId: (await t.hh.repo.findHome(green.id, 'B', '1204'))!.id, city: 'Hyderabad' }, A);
  await t.hh.repo.saveProfile(A, { fullName: 'Lakshmi Rao', language: 'te' });
  t.deskScopes.set(DESK, [green.id]);
  t.desk.sites.set(green.id, { name: 'Green Meadows', city: 'Hyderabad', centre: HOME });
  const h = { authorization: `Bearer ${await t.token({ sub: A, app_roles: [] })}`, 'content-type': 'application/json' };
  const post = (p: string, b: unknown) => t.app.request(p, { method: 'POST', headers: h, body: JSON.stringify(b) });
  if (opts.familyAlerts !== false) {
    await post('/v1/consents', { purpose: 'family_sos_alert', status: 'granted', scopeKey: '', noticeVersion: purposeMeta.family_sos_alert.noticeVersion, language: 'te' });
  }
  await post(`/v1/people/${A}/emergency-contacts`, { name: 'Ravi', phone: '+919812300001', alertsAgreed: true });
  await post(`/v1/people/${A}/emergency-contacts`, { name: 'Not asked', phone: '+919812300002' });
  await post(`/v1/people/${A}/emergency-contacts`, { name: 'Stopped', phone: '+919812300003', alertsAgreed: true });
  // A STOP reply opts the number out, whatever the resident confirmed.
  await t.deps.messaging.repo.recordOptin({ phone: '+919812300003', channel: 'whatsapp', status: 'opted_out', source: 'stop_reply' });
  t.ops.deskPhone = '+914023456789';
  t.gatePhones.set(green.id, '+914011110000');
  const raise = async () => ((await (await post('/v1/sos', { idempotencyKey: randomUUID(), location: HOME })).json()) as { id: string }).id;
  return { t, green, raise, post };
}

describe('SOS alerts (plan §13)', () => {
  it('a raised SOS starts its notification run', async () => {
    const s = await setup();
    const id = await s.raise();
    expect(s.t.notifyStarted).toEqual([id]);
  });

  it('WhatsApp to confirmed contacts (not the unconfirmed or STOPped), the desk and the gate; no health details; sent once', async () => {
    const s = await setup();
    const id = await s.raise();
    expect(await sendSosAlerts(s.t.notifyDeps(), id)).toEqual({ family: 1, desk: true, gate: true });
    expect(s.t.whatsappSent.map((m) => [m.to, m.template, m.language])).toEqual(
      expect.arrayContaining([
        ['+919812300001', 'sos_alert_family', 'te'],
        ['+914023456789', 'sos_alert_desk', 'en'],
        ['+914011110000', 'sos_alert_gate', 'en'],
      ]),
    );
    expect(s.t.whatsappSent).toHaveLength(3);
    // Only the name, the place and the reference: nothing medical.
    expect(JSON.stringify(s.t.whatsappSent)).toMatch(/Lakshmi Rao/);
    expect(JSON.stringify(s.t.whatsappSent)).toMatch(/B-1204, Green Meadows/);
    // A retried step sends nothing twice.
    expect(await sendSosAlerts(s.t.notifyDeps(), id)).toBeNull();
    expect(s.t.whatsappSent).toHaveLength(3);
  });

  it('after 60 s, SMS for each alert not delivered or read on WhatsApp', async () => {
    const s = await setup();
    const id = await s.raise();
    await sendSosAlerts(s.t.notifyDeps(), id);
    const family = s.t.messages.find((m) => m.template === 'sos_alert_family')!;
    await s.t.deps.messaging.repo.updateStatus(family.providerMessageId!, 'read');
    expect(await sendSosAlertFallback(s.t.notifyDeps(), id)).toBe(2);
    expect(s.t.smsSent.map((m) => [m.to, m.templateId])).toEqual(
      expect.arrayContaining([
        ['+914023456789', 'dlt-sos-desk'],
        ['+914011110000', 'dlt-sos-gate'],
      ]),
    );
    expect(s.t.smsSent.find((m) => m.templateId === 'dlt-sos-desk')!.variables).toMatchObject({ var1: 'Lakshmi Rao', var2: 'B-1204, Green Meadows' });
    // Once only.
    expect(await sendSosAlertFallback(s.t.notifyDeps(), id)).toBe(0);
  });

  it('with "Alert my family on every SOS" off: the desk and gate only', async () => {
    const s = await setup({ familyAlerts: false });
    const id = await s.raise();
    expect(await sendSosAlerts(s.t.notifyDeps(), id)).toEqual({ family: 0, desk: true, gate: true });
    expect(s.t.whatsappSent.some((m) => m.template === 'sos_alert_family')).toBe(false);
  });

  it('the family gets a final update when the SOS is cancelled', async () => {
    const s = await setup();
    const id = await s.raise();
    await s.post(`/v1/sos/${id}/cancel`, {});
    expect(s.t.whatsappSent.filter((m) => m.template === 'sos_update_cancelled').map((m) => m.to)).toEqual(['+919812300001']);
  });

  it('drills alert nobody', async () => {
    const s = await setup();
    const deskToken = await s.t.token({ sub: DESK, aal: 'aal2', app_roles: ['community_desk'] });
    const res = await s.t.app.request('/v1/desk/sos/test', { method: 'POST', headers: { authorization: `Bearer ${deskToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ siteId: s.green.id }) });
    const { id } = (await res.json()) as { id: string };
    expect(await sendSosAlerts(s.t.notifyDeps(), id)).toBeNull();
    expect(s.t.whatsappSent).toHaveLength(0);
  });
});
