import i18next, { type i18n } from 'i18next';
import { brandVars } from '@repo/brand';
import en from '../locales/en.json' with { type: 'json' };
import hi from '../locales/hi.json' with { type: 'json' };
import te from '../locales/te.json' with { type: 'json' };

export const languages = [
  { code: 'en', label: 'English' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'hi', label: 'हिन्दी' },
] as const;
export type Language = (typeof languages)[number]['code'];

export const resources = { en: { translation: en }, te: { translation: te }, hi: { translation: hi } };

/**
 * Creates an isolated i18next instance. {{brand}} and the other brand
 * variables are filled in from @repo/brand for every string.
 */
export function createI18n(lng: Language = 'en'): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng: 'en',
    resources,
    initAsync: false,
    interpolation: { escapeValue: false, defaultVariables: brandVars },
    returnNull: false,
  });
  return instance;
}

/** Rupee amounts with Indian digit grouping, e.g. ₹1,23,456. */
export function formatRupees(amount: number, lng: Language = 'en'): string {
  return new Intl.NumberFormat(`${lng}-IN`, {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
