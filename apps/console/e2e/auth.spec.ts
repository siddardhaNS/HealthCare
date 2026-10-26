import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createI18n } from '@repo/i18n';

const { t } = createI18n('en');

// Signed-out behaviour. The full sign-in → TOTP → command center journey
// needs the local Supabase stack and runs in the integration suite.
test('signed-out visitors are sent to sign-in', async ({ page }) => {
  for (const path of ['/', '/mfa']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});

test('sign-in form has labelled fields', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: t('console.signInTitle') })).toBeVisible();
  await expect(page.getByLabel(t('console.email'))).toHaveAttribute('type', 'email');
  await expect(page.getByLabel(t('console.password'))).toHaveAttribute('type', 'password');
});

test('explains when an account has no console role', async ({ page }) => {
  await page.goto('/sign-in?error=role');
  // Next adds its own (empty) role=alert route announcer, so match by text.
  await expect(page.getByRole('alert').filter({ hasText: t('console.notStaff') })).toBeVisible();
});

test('sign-in meets WCAG 2 AA (axe)', async ({ page }) => {
  await page.goto('/sign-in');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});
