import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { brand } from '@repo/brand';
import { createI18n } from '@repo/i18n';

const { t } = createI18n('en');
const tl = (k: string, v?: Record<string, unknown>) => t(`landing:${k}`, v);

test('landing shows the hero, every section and the brand from packages/brand', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tl('hero.title'));
  for (const id of ['services', 'sos', 'why', 'how', 'console', 'plans', 'signup', 'faq']) await expect(page.locator(`#${id}`)).toBeAttached();
  await expect(page).toHaveTitle(tl('meta.title'));
  await expect(page.getByRole('contentinfo')).toContainText(brand.legalEntityName);
});

test('service tabs switch the panel, with arrow keys too', async ({ page }) => {
  await page.goto('/');
  const lab = page.getByRole('tab', { name: /Lab tests at home/ });
  await lab.click();
  await expect(lab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('phlebotomist');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: /Visit companion/ })).toBeFocused();
});

test('sign-up: choosing a plan pre-fills it, step 1 validates, step 2 posts the lead', async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  // The API is mocked here; its own tests cover validation and storage.
  await page.route('**/v1/leads', async (route) => {
    posted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ref: 'L-7K3Q9P' }) });
  });
  await page.goto('/');

  await page.getByRole('button', { name: tl('plans.choose', { name: 'Essentials' }) }).click();
  const form = page.getByRole('form', { name: tl('signup.formLabel') });

  await form.getByRole('button', { name: tl('signup.continue') }).click();
  await expect(form.getByText(tl('signup.errors.orgName'))).toBeVisible();

  await form.getByRole('button', { name: tl('signup.types.apartment') }).click();
  await form.getByLabel(tl('signup.orgName.apartment')).fill('Green Meadows');
  await form.getByLabel(tl('signup.city')).fill('Hyderabad');
  await form.getByRole('button', { name: tl('signup.continue') }).click();

  await form.getByLabel(tl('signup.contactName')).fill('Ravi Kumar');
  await form.getByLabel(tl('signup.phone')).fill('98765 43210');
  await form.getByLabel(tl('signup.email')).fill('ravi@example.in');
  await form.getByRole('button', { name: tl('signup.submit') }).click();
  await expect(form.getByText(tl('signup.errors.consent'))).toBeVisible();

  await form.getByLabel(tl('signup.consent')).check();
  await form.getByRole('button', { name: tl('signup.submit') }).click();

  await expect(page.getByRole('status').filter({ hasText: 'L-7K3Q9P' })).toBeVisible();
  expect(posted).toMatchObject({ orgType: 'apartment', orgName: 'Green Meadows', city: 'Hyderabad', phone: '+919876543210', plan: 'essentials', consent: true });
});

test('no horizontal scrolling on a small phone', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('meets WCAG 2 AA (axe)', async ({ page }) => {
  await page.goto('/');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target.join(' ')})`)).toEqual([]);
});
