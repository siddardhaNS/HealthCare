import { describe, expect, it } from 'vitest';
import { allowedHandoverItems, purposeMeta, type ConsentPurpose } from '@repo/contracts';
import { checkUpdate, currentState, isGranted, type ConsentRow } from '../src/modules/consent/policy';
import { testContext } from './helpers';

const ME = '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11';
const SON = '0b6d3c1e-4f2a-4c8d-9e1f-2a3b4c5d6e7f';

function row(purpose: ConsentPurpose, status: 'granted' | 'withdrawn', at: number, extra: Partial<ConsentRow> = {}): ConsentRow {
  return { purpose, scopeKey: '', status, noticeVersion: purposeMeta[purpose].noticeVersion, language: 'en', actedBy: ME, userId: ME, createdAt: new Date(at), ...extra };
}

describe('consent policy', () => {
  it('the latest event wins, whatever order rows arrive in', () => {
    const rows = [row('emergency_share', 'withdrawn', 3000), row('emergency_share', 'granted', 1000)];
    expect(isGranted(rows, 'emergency_share')).toBe(false);
    expect(isGranted([...rows, row('emergency_share', 'granted', 5000)], 'emergency_share')).toBe(true);
  });

  it('never asked means not granted', () => {
    expect(isGranted([], 'proactive_care')).toBe(false);
  });

  it('a consent given against an older notice no longer counts and is flagged outdated', () => {
    const rows = [row('emergency_share', 'granted', 1000, { noticeVersion: 'emergency_share-2020-01' })];
    expect(isGranted(rows, 'emergency_share')).toBe(false);
    expect(currentState(rows).find((s) => s.purpose === 'emergency_share')).toMatchObject({ status: 'granted', outdated: true });
  });

  it('scopes are independent (one manager does not grant another)', () => {
    const rows = [row('manager', 'granted', 1000, { scopeKey: SON })];
    expect(isGranted(rows, 'manager', SON)).toBe(true);
    expect(isGranted(rows, 'manager', '11111111-1111-4111-8111-111111111111')).toBe(false);
  });

  it('lists every standing purpose, including ones never asked', () => {
    const states = currentState([]);
    for (const p of ['care_record', 'emergency_share', 'family_sos_alert', 'proactive_care', 'reminders', 'whatsapp_updates'] as const) {
      expect(states.find((s) => s.purpose === p)).toMatchObject({ status: 'not_asked' });
    }
    expect(states.some((s) => s.purpose === 'manager')).toBe(false);
  });

  it('emergency handover: everything consented, otherwise blood group only', () => {
    expect(allowedHandoverItems(false)).toEqual(['blood_group']);
    expect(allowedHandoverItems(true)).toContain('allergies');
  });

  it.each([
    ['stale notice', { purpose: 'emergency_share', status: 'granted', noticeVersion: 'old', scopeKey: '' }, 'stale_notice'],
    ['withdrawing the core record', { purpose: 'care_record', status: 'withdrawn', scopeKey: '' }, 'use_erasure'],
    ['manager without a person', { purpose: 'manager', status: 'granted', scopeKey: '' }, 'bad_scope'],
    ['manager = yourself', { purpose: 'manager', status: 'granted', scopeKey: ME }, 'bad_scope'],
    ['scope on an unscoped purpose', { purpose: 'reminders', status: 'granted', scopeKey: 'x' }, 'bad_scope'],
  ] as const)('refuses %s', (_name, u, code) => {
    const update = { language: 'en' as const, noticeVersion: purposeMeta[u.purpose].noticeVersion, ...u };
    expect(checkUpdate(ME, update)).toMatchObject({ ok: false, code });
  });
});

describe('consent API', () => {
  async function auth(t: Awaited<ReturnType<typeof testContext>>) {
    return { authorization: `Bearer ${await t.token({ sub: ME, phone: '919876543210' })}`, 'content-type': 'application/json' };
  }
  const body = (purpose: ConsentPurpose, status: 'granted' | 'withdrawn', scopeKey = '') => JSON.stringify({ purpose, status, scopeKey, noticeVersion: purposeMeta[purpose].noticeVersion, language: 'te' });

  it('requires sign-in', async () => {
    const t = await testContext();
    expect((await t.app.request('/v1/consents')).status).toBe(401);
  });

  it('grants and withdraws immediately, and keeps the full history', async () => {
    const t = await testContext();
    const headers = await auth(t);
    const granted = await t.app.request('/v1/consents', { method: 'POST', headers, body: body('emergency_share', 'granted') });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toMatchObject({ purpose: 'emergency_share', status: 'granted', outdated: false });

    const withdrawn = await t.app.request('/v1/consents', { method: 'POST', headers, body: body('emergency_share', 'withdrawn') });
    expect(await withdrawn.json()).toMatchObject({ status: 'withdrawn' });

    const hist = (await (await t.app.request('/v1/consents/history', { headers })).json()) as { events: { status: string; language: string; byManager: boolean }[] };
    expect(hist.events.map((e) => e.status)).toEqual(['withdrawn', 'granted']);
    expect(hist.events[0]).toMatchObject({ language: 'te', byManager: false });
  });

  it('records a family manager by their user id, only for someone in my household', async () => {
    const t = await testContext();
    const headers = await auth(t);
    // Not in my household yet: refused.
    const refused = await t.app.request('/v1/consents', { method: 'POST', headers, body: body('manager', 'granted', SON) });
    expect(refused.status).toBe(409);
    const hid = await t.hh.repo.createHousehold({ homeId: null, city: 'Hyderabad' }, ME);
    await t.hh.repo.addMember(hid, SON, 'member', 'son');
    expect((await t.app.request('/v1/consents', { method: 'POST', headers, body: body('manager', 'granted', SON) })).status).toBe(200);
    const list = (await (await t.app.request('/v1/consents', { headers })).json()) as { consents: { purpose: string; scopeKey: string; status: string }[] };
    expect(list.consents).toContainEqual(expect.objectContaining({ purpose: 'manager', scopeKey: SON, status: 'granted' }));
  });

  it('answers 409 with a reason instead of recording an invalid change', async () => {
    const t = await testContext();
    const res = await t.app.request('/v1/consents', { method: 'POST', headers: await auth(t), body: body('care_record', 'withdrawn') });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('use_erasure');
    expect(t.consentRows).toHaveLength(0);
  });
});
