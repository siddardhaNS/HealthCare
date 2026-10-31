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
  // Plan §13: SOS alerts. They say what happened and nothing medical.
  /** "{{1}} has raised an emergency alert. Help is being sent. We will update you." */
  sos_alert_family: { name: 'sos_alert_family', version: 1, category: 'utility', languages: ['en', 'te', 'hi'], variables: ['name'], smsTemplateEnv: 'MSG91_SOS_FAMILY_TEMPLATE_ID' },
  /** "SOS {{3}}: {{1}} at {{2}} needs help. Open the command center." */
  sos_alert_desk: { name: 'sos_alert_desk', version: 1, category: 'utility', languages: ['en'], variables: ['name', 'place', 'ref'], smsTemplateEnv: 'MSG91_SOS_DESK_TEMPLATE_ID' },
  /** "Emergency at {{1}}: an ambulance is on its way. Please keep the gate clear." */
  sos_alert_gate: { name: 'sos_alert_gate', version: 1, category: 'utility', languages: ['en'], variables: ['place'], smsTemplateEnv: 'MSG91_SOS_GATE_TEMPLATE_ID' },
  /** "{{1}} has been handed over to the team at {{2}}." */
  sos_update_handed_over: { name: 'sos_update_handed_over', version: 1, category: 'utility', languages: ['en', 'te', 'hi'], variables: ['name', 'hospital'] },
  /** "{{1}} is safe: the emergency alert was cancelled." */
  sos_update_cancelled: { name: 'sos_update_cancelled', version: 1, category: 'utility', languages: ['en', 'te', 'hi'], variables: ['name'] },
} as const satisfies Record<string, TemplateDef>;

export type TemplateName = keyof typeof templates;

/** Meta template language codes for our app languages. */
export const whatsappLanguage: Record<Language, string> = { en: 'en', te: 'te', hi: 'hi' };
