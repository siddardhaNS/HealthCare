import { describe, expect, it } from 'vitest';
import { inboundText, statusEvent, testContext, WA_VERIFY_TOKEN } from './helpers';

const PHONE = '+919876543210';

async function sendWhatsAppOtp(t: Awaited<ReturnType<typeof testContext>>) {
  await t.app.request('/v1/auth/otp-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, channel: 'whatsapp', language: 'hi' }),
  });
  await t.sendSmsHook({ user: { phone: PHONE }, sms: { otp: '305118' } });
}

describe('GET /webhooks/whatsapp (subscription)', () => {
  it('echoes the challenge for the right verify token', async () => {
    const t = await testContext();
    const res = await t.app.request(`/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WA_VERIFY_TOKEN}&hub.challenge=abc123`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('abc123');
  });

  it('refuses a wrong verify token', async () => {
    const t = await testContext();
    expect((await t.app.request('/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc')).status).toBe(403);
  });
});

describe('POST /webhooks/whatsapp', () => {
  it('rejects an invalid signature', async () => {
    const t = await testContext();
    expect((await t.whatsappWebhook(statusEvent('wamid.1', 'failed'), 'wrong-secret')).status).toBe(401);
  });

  it('re-sends a failed OTP by SMS at once, with the same code, exactly once', async () => {
    const t = await testContext();
    await sendWhatsAppOtp(t);
    expect((await t.whatsappWebhook(statusEvent('wamid.1', 'failed', 131026))).status).toBe(200);
    expect(t.smsSent).toEqual([{ to: PHONE, templateId: 'dlt-otp', variables: { otp: '305118' } }]);
    expect(t.messages.at(-1)).toMatchObject({ channel: 'sms', fallbackOf: t.messages[0]!.id, language: 'hi' });
    expect(await t.kv.get('otp-fb:wamid.1')).toBeNull();

    // Meta can deliver the same status twice.
    await t.whatsappWebhook(statusEvent('wamid.1', 'failed', 131026));
    expect(t.smsSent).toHaveLength(1);
  });

  it('discards the held code once delivered and sends no SMS', async () => {
    const t = await testContext();
    await sendWhatsAppOtp(t);
    await t.whatsappWebhook(statusEvent('wamid.1', 'delivered'));
    expect(await t.kv.get('otp-fb:wamid.1')).toBeNull();
    expect(t.smsSent).toHaveLength(0);
    expect(t.messages[0]!.status).toBe('delivered');
  });

  it('honours STOP replies at once', async () => {
    const t = await testContext();
    await t.whatsappWebhook(inboundText('919876543210', '  Stop '));
    expect(t.optins).toEqual([{ phone: PHONE, channel: 'whatsapp', status: 'opted_out', source: 'stop_reply' }]);
  });

  it('ignores other replies', async () => {
    const t = await testContext();
    await t.whatsappWebhook(inboundText('919876543210', 'hello'));
    expect(t.optins).toHaveLength(0);
  });
});
