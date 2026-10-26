import { createI18n } from '@repo/i18n';
import type landing from '@repo/i18n/locales/landing.en.json';

// Landing copy comes from packages/i18n (landing namespace). {{brand}} and
// other variables are filled in by i18next.
const i18n = createI18n('en');

/** A landing string, e.g. tl('hero.title'). */
export function tl(key: string, vars?: Record<string, unknown>): string {
  return i18n.t(`landing:${key}`, vars);
}

/** A structured value (arrays / objects) from the landing copy, interpolated. */
export function tlObj<T>(key: string): T {
  return i18n.t(`landing:${key}`, { returnObjects: true }) as T;
}

export type Landing = typeof landing;
export type ServiceItem = Landing['services']['items'][number];
export type ServiceKey = ServiceItem['key'];
export type PlanItem = { key: 'essentials' | 'complete' | 'custom'; name: string; for: string; items: string[]; popular?: boolean };
export type Step = { t: string; b: string };
