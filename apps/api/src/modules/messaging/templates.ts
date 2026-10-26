import type { Language } from '@repo/contracts';

/**
 * Versioned catalogue of approved outbound templates. The text itself is
 * approved in Meta (WhatsApp) and on the DLT portal (SMS); code only knows
 * names, categories, languages and variable names. No template may carry
 * health details, and templates should avoid the product name (see
 * docs/rename-checklist.md).
 */
export interface TemplateDef {
  name: string;
  version: number;
  category: 'authentication' | 'utility' | 'marketing';
  languages: readonly Language[];
  variables: readonly string[];
  /** Env var holding the DLT-registered MSG91 template id for the SMS version. */
  smsTemplateEnv?: string;
}

export const templates = {
  otp_code: {
    name: 'otp_code',
    version: 1,
    category: 'authentication',
    languages: ['en', 'te', 'hi'],
    variables: ['code'],
    smsTemplateEnv: 'MSG91_OTP_TEMPLATE_ID',
  },
} as const satisfies Record<string, TemplateDef>;

export type TemplateName = keyof typeof templates;

/** Meta template language codes for our app languages. */
export const whatsappLanguage: Record<Language, string> = { en: 'en', te: 'te', hi: 'hi' };
