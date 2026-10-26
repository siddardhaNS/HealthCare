import { maskPhone } from '../../lib/phone';

export class ProviderError extends Error {
  constructor(
    readonly provider: 'whatsapp' | 'sms',
    readonly code: string,
  ) {
    super(`${provider} send failed (${code})`);
  }
}

export interface WhatsAppSend {
  /** E.164 phone. */
  to: string;
  template: string;
  /** Meta language code. */
  language: string;
  components: unknown[];
}

export interface WhatsAppClient {
  sendTemplate(msg: WhatsAppSend): Promise<{ messageId: string }>;
}

export interface SmsSend {
  /** E.164 phone. */
  to: string;
  /** DLT-registered MSG91 template id. */
  templateId: string;
  variables: Record<string, string>;
}

export interface SmsClient {
  sendTemplate(msg: SmsSend): Promise<{ requestId: string | null }>;
}

/** Copy-code authentication template: the code goes in the body and the button. */
export function otpComponents(code: string): unknown[] {
  return [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
  ];
}

/** WhatsApp Cloud API (Meta, direct). */
export function cloudApiWhatsApp(cfg: { phoneNumberId: string; accessToken: string; graphVersion: string; fetch?: typeof fetch }): WhatsAppClient {
  const doFetch = cfg.fetch ?? fetch;
  return {
    async sendTemplate(msg) {
      const res = await doFetch(`https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: msg.to.replace('+', ''),
          type: 'template',
          template: { name: msg.template, language: { code: msg.language }, components: msg.components },
        }),
        signal: AbortSignal.timeout(2500),
      });
      const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number } };
      const id = body.messages?.[0]?.id;
      if (!res.ok || !id) throw new ProviderError('whatsapp', String(body.error?.code ?? res.status));
      return { messageId: id };
    },
  };
}

/**
 * MSG91 Flow API (DLT templates).
 * VERIFY BEFORE ENABLING: MSG91's legacy and current docs disagree on field
 * names (flow_id vs template_id, recipients[] vs top-level mobiles). Confirm
 * against the API page in the MSG91 dashboard once the account exists.
 */
export function msg91Sms(cfg: { authKey: string; fetch?: typeof fetch }): SmsClient {
  const doFetch = cfg.fetch ?? fetch;
  return {
    async sendTemplate(msg) {
      const res = await doFetch('https://control.msg91.com/api/v5/flow', {
        method: 'POST',
        headers: { authkey: cfg.authKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ template_id: msg.templateId, short_url: '0', recipients: [{ mobiles: msg.to.replace('+', ''), ...msg.variables }] }),
        signal: AbortSignal.timeout(2000),
      });
      const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
      if (!res.ok || body.type === 'error') throw new ProviderError('sms', String(res.status));
      return { requestId: body.type === 'success' ? (body.message ?? null) : null };
    },
  };
}

/** Local development: logs that a message would be sent. Never logs variables (they can carry codes). */
export function logWhatsApp(): WhatsAppClient {
  let n = 0;
  return {
    async sendTemplate(msg) {
      console.info(`[whatsapp:log] ${msg.template} (${msg.language}) → ${maskPhone(msg.to)}`);
      return { messageId: `wamid.local.${Date.now()}.${++n}` };
    },
  };
}

export function logSms(): SmsClient {
  return {
    async sendTemplate(msg) {
      console.info(`[sms:log] template ${msg.templateId} → ${maskPhone(msg.to)}`);
      return { requestId: null };
    },
  };
}
