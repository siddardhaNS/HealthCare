import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { brand } from '@repo/brand';
import { createI18n } from '@repo/i18n';

const { t } = createI18n('en');

test('landing shows the hero, call to action and services', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('web.heroTitle'));
  await expect(page.getByRole('button', { name: t('web.cta') })).toBeVisible();
  for (const s of ['consult', 'pharmacy', 'lab', 'companion'] as const) await expect(page.getByText(t(`home.services.${s}.title`))).toBeVisible();
  await expect(page).toHaveTitle(brand.name);
});

test('no horizontal scrolling on a small phone', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('meets WCAG 2 AA (axe)', async ({ page }) => {
  await page.goto('/');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
