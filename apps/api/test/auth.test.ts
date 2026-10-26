import { describe, expect, it } from 'vitest';
import { HOOK_SECRET, testContext } from './helpers';

const PHONE = '+919876543210';
const hookBody = (phone = PHONE, otp = '482913') => ({ user: { id: 'u1', phone: phone.replace('+', '') }, sms: { otp } });

async function intent(app: Awaited<ReturnType<typeof testContext>>['app'], channel: 'whatsapp' | 'sms', phone = PHONE) {
  return app.request('/v1/auth/otp-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, channel, language: 'te' }),
  });
}

describe('POST /v1/auth/otp-intent', () => {
  it('accepts a valid intent without recording consent', async () => {
    const t = await testContext();
    expect((await intent(t.app, 'whatsapp')).status).toBe(204);
    expect(t.optins).toHaveLength(0);
  });

  it('rejects numbers that are not Indian mobiles', async () => {
    const t = await testContext();
    expect((await intent(t.app, 'sms', '+14155550100')).status).toBe(400);
  });

  it('rate-limits per IP', async () => {
    const t = await testContext();
    for (let i = 0; i < 20; i++) expect((await intent(t.app, 'sms')).status).toBe(204);
    const res = await intent(t.app, 'sms');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('Send SMS hook', () => {
  it('rejects a bad signature', async () => {
    const t = await testContext();
    const res = await t.sendSmsHook(hookBody(), `v1,whsec_${Buffer.alloc(32, 1).toString('base64')}`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(t.whatsappSent).toHaveLength(0);
    expect(t.smsSent).toHaveLength(0);
  });

  it('sends on WhatsApp in the chosen language when the user picked it, and holds the code only encrypted', async () => {
    const t = await testContext();
    await intent(t.app, 'whatsapp');
    const res = await t.sendSmsHook(hookBody());
    expect(res.status).toBe(200);
    expect(t.whatsappSent).toHaveLength(1);
    expect(t.whatsappSent[0]!.language).toBe('te');
    expect(t.smsSent).toHaveLength(0);
    const held = await t.kv.get<string>('otp-fb:wamid.1');
    expect(held).toBeTruthy();
    expect(held).not.toContain('482913');
    expect(t.messages[0]).toMatchObject({ channel: 'whatsapp', status: 'sent', purpose: 'otp' });
    expect(JSON.stringify(t.messages)).not.toContain('482913');
  });

  it('defaults to SMS when there is no intent', async () => {
    const t = await testContext();
    expect((await t.sendSmsHook(hookBody())).status).toBe(200);
    expect(t.smsSent).toEqual([{ to: PHONE, templateId: 'dlt-otp', variables: { otp: '482913' } }]);
    expect(t.whatsappSent).toHaveLength(0);
  });

  it('falls through to SMS in the same request when WhatsApp fails', async () => {
    const t = await testContext({ whatsappFails: true });
    await intent(t.app, 'whatsapp');
    expect((await t.sendSmsHook(hookBody())).status).toBe(200);
    expect(t.smsSent).toHaveLength(1);
    const [wa, sms] = t.messages;
    expect(wa).toMatchObject({ channel: 'whatsapp', status: 'failed', errorCode: '131026' });
    expect(sms).toMatchObject({ channel: 'sms', fallbackOf: wa!.id });
    expect(t.challenges.at(-1)).toMatchObject({ outcome: 'fallback_sms' });
  });

  it('allows one code per 30 s per phone and answers 429 without retry-after', async () => {
    const t = await testContext();
    expect((await t.sendSmsHook(hookBody())).status).toBe(200);
    const res = await t.sendSmsHook(hookBody());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeNull();
    expect(await res.json()).toMatchObject({ error: { http_code: 429 } });
    expect(t.smsSent).toHaveLength(1);
    expect(t.challenges.at(-1)).toMatchObject({ outcome: 'rate_limited' });
  });

  it('rejects non-Indian numbers', async () => {
    const t = await testContext();
    expect((await t.sendSmsHook(hookBody('+14155550100'))).status).toBe(400);
  });

  it('uses a v1,whsec_ secret', () => {
    expect(HOOK_SECRET.startsWith('v1,whsec_')).toBe(true);
  });
});

describe('access tokens', () => {
  it('GET /v1/me returns the verified user with roles from the token', async () => {
    const t = await testContext();
    const token = await t.token({ sub: '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11', phone: '919876543210', aal: 'aal1', app_roles: ['crew', 'not_a_role'] });
    const res = await t.app.request('/v1/me', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11', phone: '919876543210', roles: ['crew'], aal: 'aal1' });
  });

  it.each([
    ['missing', async () => undefined],
    ['expired', async (t: Awaited<ReturnType<typeof testContext>>) => t.token({ sub: 'u' }, { expiresIn: '-1m' })],
    ['wrong issuer', async (t: Awaited<ReturnType<typeof testContext>>) => t.token({ sub: 'u' }, { issuer: 'https://evil.test/auth/v1' })],
  ])('rejects a %s token', async (_name, make) => {
    const t = await testContext();
    const token = await make(t);
    const res = await t.app.request('/v1/me', token ? { headers: { authorization: `Bearer ${token}` } } : {});
    expect(res.status).toBe(401);
  });

  it('records the WhatsApp opt-in only for the verified phone in the token', async () => {
    const t = await testContext();
    const token = await t.token({ sub: '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11', phone: '919876543210' });
    const res = await t.app.request('/v1/auth/whatsapp-optin', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ consentVersion: 'wa-2026-10' }),
    });
    expect(res.status).toBe(204);
    expect(t.optins).toEqual([{ phone: PHONE, channel: 'whatsapp', status: 'opted_in', source: 'signin', consentVersion: 'wa-2026-10' }]);
  });

  it('refuses the opt-in without a verified phone', async () => {
    const t = await testContext();
    const token = await t.token({ sub: '6f1c2a8e-1d7b-4b8f-9a55-0c8e2b7d4f11' });
    const res = await t.app.request('/v1/auth/whatsapp-optin', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ consentVersion: 'wa-2026-10' }),
    });
    expect(res.status).toBe(400);
    expect(t.optins).toHaveLength(0);
  });
});
