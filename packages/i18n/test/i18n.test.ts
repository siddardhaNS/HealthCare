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
