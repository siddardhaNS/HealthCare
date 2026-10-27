import { describe, expect, it } from 'vitest';
import { brand } from '@repo/brand';
import { createI18n, formatRupees, resources } from '../src/index';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('i18n', () => {
  it('fills {{brand}} from @repo/brand', () => {
    expect(createI18n('en').t('web.cta')).toBe(`Bring ${brand.name} to your community`);
  });

  it('every language has the same keys as English', () => {
    const en = keys(resources.en.translation).sort();
    expect(keys(resources.te.translation).sort()).toEqual(en);
    expect(keys(resources.hi.translation).sort()).toEqual(en);
  });

  it('formats rupees with Indian digit grouping', () => {
    expect(formatRupees(123456)).toBe('₹1,23,456');
  });
});

describe('landing namespace', () => {
  it('is available and falls back to English', () => {
    expect(createI18n('en').t('landing:nav.services')).toBe('Services');
    expect(createI18n('te').t('landing:nav.services')).toBe('Services');
  });

  it('fills {{brand}} in landing copy', () => {
    expect(createI18n('en').t('landing:signup.consent')).toContain(brand.name);
  });
});

describe('consent notices', () => {
  it('every purpose in the catalogue has a notice in every language', async () => {
    const { consentPurposes } = await import('@repo/contracts/consent');
    for (const lng of ['en', 'te', 'hi'] as const) {
      const consent = (resources[lng].translation as unknown as { consent: Record<string, { title: string; body: string }> }).consent;
      for (const p of consentPurposes) {
        expect(consent[p]?.title, `${lng}.${p}`).toBeTruthy();
        expect(consent[p]?.body, `${lng}.${p}`).toBeTruthy();
      }
    }
  });
});
