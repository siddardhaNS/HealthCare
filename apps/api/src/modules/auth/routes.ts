import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { Webhook } from 'standardwebhooks';
import { ErrorBody, Language, Me, OtpChannel, OtpIntentRequest, WhatsappOptinRequest, type ErrorBody as ErrorBodyT } from '@repo/contracts';
import type { AppEnv } from '../../app';
import { hashPhone } from '../../lib/crypto';
import { normalizeIndianPhone } from '../../lib/phone';
import { checkLimits } from '../../lib/rate-limit';
import { requireAuth } from '../../middleware/auth';
import { sendOtp } from '../messaging/service';

/** How long a channel choice is remembered between the intent call and the OTP send. */
export const OTP_INTENT_TTL_SECONDS = 600;
export const intentKey = (phone: string) => `otp-intent:${phone}`;

interface OtpIntent {
  channel: OtpChannel;
  language: Language;
}

const otpIntent = createRoute({
  method: 'post',
  path: '/auth/otp-intent',
  operationId: 'createOtpIntent',
  tags: ['auth'],
  summary: 'Choose the OTP channel before calling Supabase signInWithOtp',
  description: 'Remembers the channel for the next OTP to this phone. The WhatsApp opt-in is recorded only after sign-in (POST /auth/whatsapp-optin), once the phone is verified.',
  request: { body: { content: { 'application/json': { schema: OtpIntentRequest } }, required: true } },
  responses: {
    204: { description: 'Recorded' },
    429: { description: 'Too many requests', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const whatsappOptin = createRoute({
  method: 'post',
  path: '/auth/whatsapp-optin',
  operationId: 'recordWhatsappOptin',
  tags: ['auth'],
  summary: 'Record WhatsApp consent for the verified phone of the signed-in user',
  security: [{ bearer: [] }],
  middleware: [requireAuth] as const,
  request: { body: { content: { 'application/json': { schema: WhatsappOptinRequest } }, required: true } },
  responses: {
    204: { description: 'Recorded' },
    400: { description: 'No verified phone on this account', content: { 'application/json': { schema: ErrorBody } } },
    401: { description: 'Not signed in', content: { 'application/json': { schema: ErrorBody } } },
  },
});

const me = createRoute({
  method: 'get',
  path: '/me',
  operationId: 'getMe',
  tags: ['auth'],
  summary: 'The signed-in user',
  security: [{ bearer: [] }],
  middleware: [requireAuth] as const,
  responses: {
    200: { description: 'Current user', content: { 'application/json': { schema: Me } } },
    401: { description: 'Not signed in', content: { 'application/json': { schema: ErrorBody } } },
  },
});

function clientIp(header: string | undefined): string {
  return header?.split(',')[0]?.trim() || 'unknown';
}

const tooMany = (requestId: string, retryAfter: number): ErrorBodyT => ({
  error: { code: 'rate_limited', message: `Too many requests. Try again in ${retryAfter} s.`, requestId },
});

export const authRoutes = new OpenAPIHono<AppEnv>()
  .openapi(otpIntent, async (c) => {
    const body = c.req.valid('json');
    const { kv } = c.get('deps');
    const ip = clientIp(c.req.header('x-forwarded-for'));
    const limited = await checkLimits(kv, `otp-intent:ip:${ip}`, [{ limit: 20, windowSeconds: 3600 }]);
    if (!limited.ok) {
      c.header('retry-after', String(limited.retryAfterSeconds));
      return c.json(tooMany(c.get('requestId'), limited.retryAfterSeconds), 429);
    }
    const intent: OtpIntent = { channel: body.channel, language: body.language };
    await kv.set(intentKey(body.phone), intent, OTP_INTENT_TTL_SECONDS);
    return c.body(null, 204);
  })
  .openapi(whatsappOptin, async (c) => {
    const auth = c.get('auth')!;
    const phone = auth.phone ? normalizeIndianPhone(auth.phone) : null;
    if (!phone) return c.json<ErrorBodyT>({ error: { code: 'no_phone', message: 'No verified phone on this account', requestId: c.get('requestId') } }, 400);
    const { consentVersion } = c.req.valid('json');
    await c.get('deps').messaging.repo.recordOptin({ phone, channel: 'whatsapp', status: 'opted_in', source: 'signin', consentVersion });
    return c.body(null, 204);
  })
  .openapi(me, (c) => {
    const auth = c.get('auth')!;
    return c.json({ userId: auth.userId, phone: auth.phone, roles: auth.roles, aal: auth.aal }, 200);
  });

/**
 * Supabase Auth "Send SMS" hook (Standard Webhooks). Not in the public
 * OpenAPI document. Must answer within Supabase's 5 s budget; every response
 * is JSON. 429 is sent without retry-after so Auth does not retry it.
 */
export const authHookRoutes = new OpenAPIHono<AppEnv>().post('/auth/hooks/send-sms', async (c) => {
  const deps = c.get('deps');
  const hookError = (status: 400 | 401 | 429 | 500, message: string) => c.json({ error: { http_code: status, message } }, status);

  const raw = await c.req.text();
  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    const wh = new Webhook(deps.config.sendSmsHookSecret.replace(/^v1,/, ''));
    payload = wh.verify(raw, Object.fromEntries(c.req.raw.headers)) as typeof payload;
  } catch {
    return hookError(401, 'Invalid signature');
  }

  const phone = normalizeIndianPhone(payload.user?.phone ?? '');
  const code = payload.sms?.otp;
  if (!phone || !code) return hookError(400, 'Only Indian mobile numbers are supported');

  const phoneHash = hashPhone(deps.config.phoneHashKey, phone);
  const limited = await checkLimits(deps.kv, `otp:${phoneHash}`, [
    { limit: 1, windowSeconds: 30 },
    { limit: 5, windowSeconds: 3600 },
  ]);
  if (!limited.ok) {
    await deps.messaging.repo.recordOtpChallenge({ phoneHash, channel: 'sms', outcome: 'rate_limited' });
    return hookError(429, `Please wait ${limited.retryAfterSeconds} s before requesting another code`);
  }

  const intent = await deps.kv.get<OtpIntent>(intentKey(phone));
  const channel = intent?.channel ?? 'sms';
  try {
    const outcome = await sendOtp(deps.messaging, { phone, code, channel, language: intent?.language ?? 'en' });
    await deps.messaging.repo.recordOtpChallenge({ phoneHash, channel, outcome });
    return c.json({}, 200);
  } catch {
    await deps.messaging.repo.recordOtpChallenge({ phoneHash, channel, outcome: 'failed' }).catch(() => undefined);
    return hookError(500, 'Could not send the code');
  }
});
