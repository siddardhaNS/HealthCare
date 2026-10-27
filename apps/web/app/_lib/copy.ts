import type { leadServices } from '@repo/contracts/leads';
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
/** JSON imports widen literals to string, so the key comes from the shared constant. */
export type ServiceKey = (typeof leadServices)[number];
export type ServiceItem = Omit<Landing['services']['items'][number], 'key'> & { key: ServiceKey };
export type PlanItem = { key: 'essentials' | 'complete' | 'custom'; name: string; for: string; items: string[]; popular?: boolean };
export type Step = { t: string; b: string };
