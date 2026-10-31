import { describe, expect, it } from 'vitest';
import { GatewayError, checkoutSignature, razorpayGateway, sameSignature, webhookSignature } from '../src/modules/payments/gateway';

describe('Razorpay signatures (docs read 2026-10-31)', () => {
  it('checkout: HMAC-SHA256 of order_id|payment_id with the key secret, hex', () => {
    // Independently computed: printf '%s' 'order_X|pay_Y' | openssl dgst -sha256 -hmac secret
    expect(checkoutSignature('secret', 'order_X', 'pay_Y')).toBe('bff0253d929e5412fff37172ea2b01ce8c27545979cf78d688763d7eb9307cef');
    const g = razorpayGateway({ keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'whsec' });
    const signature = checkoutSignature('secret', 'order_X', 'pay_Y');
    expect(g.verifyCheckout({ orderId: 'order_X', paymentId: 'pay_Y', signature })).toBe(true);
    // The order id must be ours: a signature for another order fails.
    expect(g.verifyCheckout({ orderId: 'order_Z', paymentId: 'pay_Y', signature })).toBe(false);
    expect(g.verifyCheckout({ orderId: 'order_X', paymentId: 'pay_Y', signature: signature.slice(1) })).toBe(false);
  });

  it('webhook: HMAC-SHA256 of the raw body with the webhook secret (not the key secret)', () => {
    const g = razorpayGateway({ keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'whsec' });
    const raw = '{"event":"payment.captured","payload":{}}';
    expect(g.verifyWebhook(raw, webhookSignature('whsec', raw))).toBe(true);
    expect(g.verifyWebhook(raw, webhookSignature('secret', raw))).toBe(false);
    // Re-serialised JSON is different bytes: the raw body is what is signed.
    expect(g.verifyWebhook('{"event": "payment.captured","payload":{}}', webhookSignature('whsec', raw))).toBe(false);
    expect(sameSignature('abc', 'abd')).toBe(false);
  });

  it('creates an order in paise with Basic auth, and surfaces Razorpay errors', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = razorpayGateway({
      keyId: 'rzp_test_x',
      keySecret: 'secret',
      webhookSecret: 'whsec',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ id: 'order_ABC' }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(await ok.createOrder({ amountPaise: 50000, receipt: 'appt_1' })).toEqual({ orderId: 'order_ABC' });
    expect(calls[0]!.url).toBe('https://api.razorpay.com/v1/orders');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('rzp_test_x:secret').toString('base64')}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ amount: 50000, currency: 'INR', receipt: 'appt_1' });

    const bad = razorpayGateway({
      keyId: 'k',
      keySecret: 's',
      webhookSecret: 'w',
      fetch: (async () => new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR' } }), { status: 400 })) as unknown as typeof fetch,
    });
    await expect(bad.createOrder({ amountPaise: 50, receipt: 'x' })).rejects.toEqual(new GatewayError(400, 'BAD_REQUEST_ERROR'));
  });
});
