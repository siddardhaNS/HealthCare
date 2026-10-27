// Consent catalogue (dependency-free, safe for app bundles). Mirrors the
// purpose check in supabase/migrations/*_consent.sql. Notice text lives in
// @repo/i18n under consent.<purpose>; bump the version here whenever that
// text changes so each recorded consent points at what the person saw.

export const consentPurposes = [
  'care_record',
  'emergency_share',
  'family_sos_alert',
  'doctor_share',
  'proactive_care',
  'manager',
  'whatsapp_updates',
  'reminders',
] as const;
export type ConsentPurpose = (typeof consentPurposes)[number];

export interface PurposeMeta {
  /** Needed to use health features at all. */
  required: boolean;
  /** Asked once and kept until withdrawn (vs. per booking / per person). */
  standing: boolean;
  /** Shown on the onboarding consent screen. */
  onboarding: boolean;
  noticeVersion: string;
}

export const purposeMeta: Record<ConsentPurpose, PurposeMeta> = {
  care_record: { required: true, standing: true, onboarding: true, noticeVersion: 'care_record-2026-10' },
  emergency_share: { required: false, standing: true, onboarding: true, noticeVersion: 'emergency_share-2026-10' },
  family_sos_alert: { required: false, standing: true, onboarding: true, noticeVersion: 'family_sos_alert-2026-10' },
  proactive_care: { required: false, standing: true, onboarding: true, noticeVersion: 'proactive_care-2026-10' },
  reminders: { required: false, standing: true, onboarding: true, noticeVersion: 'reminders-2026-10' },
  // Asked at each booking (scope = booking id).
  doctor_share: { required: false, standing: false, onboarding: false, noticeVersion: 'doctor_share-2026-10' },
  // Granted per family member (scope = their user id).
  manager: { required: false, standing: false, onboarding: false, noticeVersion: 'manager-2026-10' },
  // Recorded after phone sign-in (Phase 1).
  whatsapp_updates: { required: false, standing: true, onboarding: false, noticeVersion: 'wa-2026-10' },
};

/** Fields of the emergency handover record sent to the receiving hospital. */
export const handoverItems = ['blood_group', 'allergies', 'conditions', 'medicines', 'last_vitals', 'emergency_contacts', 'insurance'] as const;
export type HandoverItem = (typeof handoverItems)[number];

/** Brief: share only what the person consented to; with consent off, the blood group only. */
export function allowedHandoverItems(emergencyShareGranted: boolean): readonly HandoverItem[] {
  return emergencyShareGranted ? handoverItems : ['blood_group'];
}

/** What a doctor may see for one booking (the design's four choices). */
export const doctorShareItems = ['vitals', 'conditions_allergies', 'medicines', 'lab_reports'] as const;
export type DoctorShareItem = (typeof doctorShareItems)[number];
