import type { Language, OtpChannel } from '@repo/contracts';
import { decryptJson, encryptJson } from '../../lib/crypto';
import type { Kv } from '../../lib/kv';
import { maskPhone } from '../../lib/phone';
import { ProviderError, otpComponents, type SmsClient, type WhatsAppClient } from './providers';
import type { MessagingRepo } from './repo';
import { templates, whatsappLanguage } from './templates';

/** How long a WhatsApp OTP can still fall back to SMS (matches the OTP lifetime). */
export const OTP_FALLBACK_TTL_SECONDS = 600;

export interface MessagingDeps {
  kv: Kv;
  repo: MessagingRepo;
  whatsapp: WhatsAppClient;
  sms: SmsClient;
  /** 32-byte AES key for codes held for SMS fallback. */
  fallbackKey: Buffer;
  smsTemplateIds: { otp_code: string };
}

interface OtpFallback {
  phone: string;
  language: Language;
  code: string;
  logId: string;
}

const fallbackKey = (messageId: string) => `otp-fb:${messageId}`;

export type OtpOutcome = 'sent' | 'fallback_sms';

/** Sends an OTP on the chosen channel. WhatsApp failures fall through to SMS in the same call. */
export async function sendOtp(deps: MessagingDeps, input: { phone: string; code: string; channel: OtpChannel; language: Language }): Promise<OtpOutcome> {
  const t = templates.otp_code;
  const base = { category: t.category, template: t.name, templateVersion: t.version, language: input.language, toPhone: input.phone, purpose: 'otp' } as const;

  if (input.channel === 'whatsapp') {
    try {
      const { messageId } = await deps.whatsapp.sendTemplate({
        to: input.phone,
        template: t.name,
        language: whatsappLanguage[input.language],
        components: otpComponents(input.code),
      });
      const { id } = await deps.repo.logMessage({ ...base, channel: 'whatsapp', providerMessageId: messageId, status: 'sent' });
      const held: OtpFallback = { phone: input.phone, language: input.language, code: input.code, logId: id };
      await deps.kv.set(fallbackKey(messageId), encryptJson(deps.fallbackKey, held), OTP_FALLBACK_TTL_SECONDS);
      return 'sent';
    } catch (err) {
      const code = err instanceof ProviderError ? err.code : 'unknown';
      console.warn(JSON.stringify({ level: 'warn', msg: 'whatsapp otp failed, using sms', to: maskPhone(input.phone), code }));
      const { id } = await deps.repo.logMessage({ ...base, channel: 'whatsapp', status: 'failed', errorCode: code });
      await sendOtpSms(deps, { ...input, fallbackOf: id });
      return 'fallback_sms';
    }
  }

  await sendOtpSms(deps, { ...input, fallbackOf: null });
  return 'sent';
}

async function sendOtpSms(deps: MessagingDeps, input: { phone: string; code: string; language: Language; fallbackOf: string | null }) {
  const t = templates.otp_code;
  const { requestId } = await deps.sms.sendTemplate({ to: input.phone, templateId: deps.smsTemplateIds.otp_code, variables: { otp: input.code } });
  await deps.repo.logMessage({
    channel: 'sms',
    category: t.category,
    template: t.name,
    templateVersion: t.version,
    language: input.language,
    toPhone: input.phone,
    purpose: 'otp',
    providerMessageId: requestId,
    status: 'sent',
    fallbackOf: input.fallbackOf,
  });
}

export type WhatsAppStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Applies a WhatsApp delivery status. A failed OTP is re-sent by SMS at once
 * using the held, encrypted code; delivered/read discards the held code.
 */
export async function handleWhatsAppStatus(deps: MessagingDeps, s: { messageId: string; status: WhatsAppStatus; errorCode?: string | null }): Promise<'fallback_sent' | 'updated'> {
  await deps.repo.updateStatus(s.messageId, s.status, s.errorCode);
  if (s.status === 'sent') return 'updated';

  const key = fallbackKey(s.messageId);
  const held = await deps.kv.get<string>(key);
  if (!held) return 'updated';
  await deps.kv.del(key);
  if (s.status !== 'failed') return 'updated';

  const fb = decryptJson<OtpFallback>(deps.fallbackKey, held);
  await sendOtpSms(deps, { phone: fb.phone, code: fb.code, language: fb.language, fallbackOf: fb.logId });
  return 'fallback_sent';
}

const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop all', 'रोकें', 'ఆపు']);

export function isStopMessage(text: string): boolean {
  return STOP_WORDS.has(text.trim().toLowerCase());
}

/** Honours a STOP reply at once by recording an opt-out. */
export async function handleInboundText(deps: Pick<MessagingDeps, 'repo'>, msg: { phone: string; text: string }): Promise<'opted_out' | 'ignored'> {
  if (!isStopMessage(msg.text)) return 'ignored';
  await deps.repo.recordOptin({ phone: msg.phone, channel: 'whatsapp', status: 'opted_out', source: 'stop_reply' });
  return 'opted_out';
}
