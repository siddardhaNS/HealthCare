// Payments (Phase 4 ⚑2): Razorpay orders, signature checks and refunds, per the
// docs read 2026-10-31 (Orders API, Standard Checkout "Verify Payment Signature",
// webhooks validate-test, Refunds "create normal"). Amounts are integer paise.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface PaymentGateway {
  /** The public key id the app's checkout needs (never the secret). */
  readonly keyId: string;
  /** One order per payment attempt (Razorpay: "create a new order for every payment attempt"). */
  createOrder(o: { amountPaise: number; receipt: string; notes?: Record<string, string> }): Promise<{ orderId: string }>;
  refund(r: { paymentId: string; amountPaise: number; receipt: string }): Promise<{ refundId: string; status: 'pending' | 'processed' | 'failed' }>;
  /** Checkout's success callback: HMAC-SHA256 of `order_id|payment_id` with the API key secret, hex. */
  verifyCheckout(c: { orderId: string; paymentId: string; signature: string }): boolean;
  /** Webhooks: HMAC-SHA256 of the raw body with the webhook secret, hex, in X-Razorpay-Signature. */
  verifyWebhook(rawBody: string, signature: string): boolean;
}

const hmacHex = (secret: string, message: string) => createHmac('sha256', secret).update(message).digest('hex');
/** Constant-time comparison of two hex signatures. */
export function sameSignature(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const checkoutSignature = (keySecret: string, orderId: string, paymentId: string) => hmacHex(keySecret, `${orderId}|${paymentId}`);
export const webhookSignature = (webhookSecret: string, rawBody: string) => hmacHex(webhookSecret, rawBody);

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`razorpay ${status} ${code}`);
  }
}

export function razorpayGateway(cfg: { keyId: string; keySecret: string; webhookSecret: string; fetch?: typeof fetch }): PaymentGateway {
  const doFetch = cfg.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`;
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await doFetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: string } };
    if (!res.ok) throw new GatewayError(res.status, json.error?.code ?? 'unknown');
    return json;
  };
  return {
    keyId: cfg.keyId,
    async createOrder({ amountPaise, receipt, notes }) {
      const r = await call<{ id: string }>('/orders', { amount: amountPaise, currency: 'INR', receipt, ...(notes ? { notes } : {}) });
      return { orderId: r.id };
    },
    async refund({ paymentId, amountPaise, receipt }) {
      const r = await call<{ id: string; status: 'pending' | 'processed' | 'failed' }>(`/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, speed: 'normal', receipt });
      return { refundId: r.id, status: r.status };
    },
    verifyCheckout: ({ orderId, paymentId, signature }) => sameSignature(checkoutSignature(cfg.keySecret, orderId, paymentId), signature),
    verifyWebhook: (rawBody, signature) => sameSignature(webhookSignature(cfg.webhookSecret, rawBody), signature),
  };
}

/**
 * Local development and tests without Razorpay keys: same shapes and the same
 * signature rules, with secrets that exist only in this process. Never used
 * in production (deps refuses to start without keys there).
 */
export function localGateway(cfg: { keySecret: string; webhookSecret: string }): PaymentGateway & { orders: { orderId: string; amountPaise: number; receipt: string }[]; refunds: { paymentId: string; amountPaise: number }[] } {
  const orders: { orderId: string; amountPaise: number; receipt: string }[] = [];
  const refunds: { paymentId: string; amountPaise: number }[] = [];
  return {
    keyId: 'rzp_local',
    orders,
    refunds,
    async createOrder({ amountPaise, receipt }) {
      const orderId = `order_local_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
      orders.push({ orderId, amountPaise, receipt });
      return { orderId };
    },
    async refund({ paymentId, amountPaise }) {
      refunds.push({ paymentId, amountPaise });
      return { refundId: `rfnd_local_${refunds.length}`, status: 'pending' };
    },
    verifyCheckout: ({ orderId, paymentId, signature }) => sameSignature(checkoutSignature(cfg.keySecret, orderId, paymentId), signature),
    verifyWebhook: (rawBody, signature) => sameSignature(webhookSignature(cfg.webhookSecret, rawBody), signature),
  };
}
