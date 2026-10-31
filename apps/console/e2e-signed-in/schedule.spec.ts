import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createI18n } from '@repo/i18n';
import { doctorState } from './fixtures';

const { t } = createI18n('en');

// Phase 4 ⚑3: the doctor sets weekly hours; the page shows the bookable slots they make; leave removes a day.
test.describe('as a doctor', () => {
  test.use({ storageState: doctorState });

  test('weekly hours make slots for the next 7 days; leave removes them; WCAG 2 AA', async ({ page }) => {
    await page.goto('/schedule');
    const preview = page.getByTestId('slot-preview');
    await expect(preview).toContainText(t('console.schedule.previewEmpty'));

    // 18:00–19:00 every day, video (ticked by default for an offered type). Late enough that most of today still counts.
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      await page.locator(`input[name="h${weekday}_0_start"]`).fill('18:00');
      await page.locator(`input[name="h${weekday}_0_end"]`).fill('19:00');
    }
    await page.getByRole('button', { name: t('console.schedule.saveHours') }).click();
    await expect(page.getByRole('status').filter({ hasText: t('console.schedule.saved') }).first()).toBeVisible();
    await page.reload();
    const days = preview.locator('dt');
    // Seven days ahead, or six once today's evening slots have passed.
    await expect(days.first()).toBeVisible();
    const before = await days.count();
    expect(before).toBeGreaterThanOrEqual(6);

    // Leave the day after tomorrow (IST).
    const leave = new Date(Date.now() + 2 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
    await page.getByLabel(t('console.schedule.fromDate')).fill(leave);
    await page.getByRole('button', { name: t('console.schedule.addException') }).click();
    // Saved once it is listed (then the slots are recomputed on the next load).
    await expect(page.getByText(`${t('console.schedule.kind.off')}: ${leave}`)).toBeVisible();
    await page.reload();
    await expect(preview.locator('dt')).toHaveCount(before - 1);

    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} (${n.any[0]?.message ?? ''})`))).toEqual([]);
  });
});
