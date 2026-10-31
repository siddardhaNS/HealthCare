import { expect, test as setup, type Page } from '@playwright/test';
import { createI18n } from '@repo/i18n';
import { accounts, adminState, doctorState, erState, totp, type Account } from './fixtures';

const { t } = createI18n('en');

/** The real journey: email + password, then the TOTP code. Retries once in the next 30 s window if a code is refused as already used. */
async function signIn(page: Page, who: Account) {
  await page.goto('/sign-in');
  await page.getByLabel(t('console.email')).fill(who.email);
  await page.getByLabel(t('console.password')).fill(who.password);
  await page.getByRole('button', { name: t('web.signIn') }).click();
  await expect(page).toHaveURL(/\/mfa$/);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel(t('console.mfaCode')).fill(totp(who.totpSecret!));
    await page.getByRole('button', { name: t('console.verify') }).click();
    if (await page.waitForURL((u) => !u.pathname.startsWith('/mfa'), { timeout: 8_000 }).then(() => true, () => false)) return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
  }
  throw new Error(`TOTP sign-in failed for ${who.email}`);
}

setup('super admin signs in with password and TOTP', async ({ page }) => {
  await signIn(page, accounts().admin);
  await expect(page.getByRole('heading', { name: t('console.commandCenter') })).toBeVisible();
  await page.context().storageState({ path: adminState });
});

setup('hospital staff sign in and land on incoming patients', async ({ page }) => {
  await signIn(page, accounts().er);
  await expect(page).toHaveURL(/\/handovers$/);
  await expect(page.getByRole('heading', { name: t('console.partner.title') })).toBeVisible();
  await page.context().storageState({ path: erState });
});

setup('a doctor signs in and lands on their schedule', async ({ page }) => {
  await signIn(page, accounts().doctor);
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(page.getByRole('heading', { name: t('console.schedule.title') })).toBeVisible();
  await page.context().storageState({ path: doctorState });
});
