import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../../app';
import { verifyMetaSignature } from '../../lib/crypto';
import { normalizeIndianPhone } from '../../lib/phone';
import { handleInboundText, handleWhatsAppStatus, type WhatsAppStatus } from './service';

interface WebhookBody {
  entry?: {
    changes?: {
      value?: {
        statuses?: { id: string; status: string; errors?: { code?: number }[] }[];
        messages?: { from: string; type: string; text?: { body?: string }; button?: { text?: string } }[];
      };
    }[];
  }[];
}

const knownStatuses = new Set<WhatsAppStatus>(['sent', 'delivered', 'read', 'failed']);

/** Meta WhatsApp Cloud API webhooks: delivery receipts and replies. */
export const whatsappWebhookRoutes = new OpenAPIHono<AppEnv>()
  // Subscription handshake.
  .get('/webhooks/whatsapp', (c) => {
    const token = c.get('deps').config.whatsappVerifyToken;
    const ok = c.req.query('hub.mode') === 'subscribe' && !!token && c.req.query('hub.verify_token') === token;
    return ok ? c.text(c.req.query('hub.challenge') ?? '') : c.text('Forbidden', 403);
  })
  .post('/webhooks/whatsapp', async (c) => {
    const deps = c.get('deps');
    const raw = await c.req.text();
    if (!deps.config.whatsappAppSecret || !verifyMetaSignature(deps.config.whatsappAppSecret, raw, c.req.header('x-hub-signature-256'))) {
      return c.text('Invalid signature', 401);
    }

    const body = JSON.parse(raw) as WebhookBody;
    for (const change of body.entry?.flatMap((e) => e.changes ?? []) ?? []) {
      for (const s of change.value?.statuses ?? []) {
        if (!knownStatuses.has(s.status as WhatsAppStatus)) continue;
        await handleWhatsAppStatus(deps.messaging, {
          messageId: s.id,
          status: s.status as WhatsAppStatus,
          errorCode: s.errors?.[0]?.code != null ? String(s.errors[0].code) : null,
        });
      }
      for (const m of change.value?.messages ?? []) {
        const phone = normalizeIndianPhone(m.from);
        const text = m.text?.body ?? m.button?.text;
        if (phone && text) await handleInboundText(deps.messaging, { phone, text });
      }
    }
    // Meta retries non-2xx responses; acknowledge once processed.
    return c.text('ok');
  });
