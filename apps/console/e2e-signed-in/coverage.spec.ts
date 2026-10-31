import { expect, test } from '@playwright/test';
import { createI18n } from '@repo/i18n';
import { accounts, adminState, api } from './fixtures';

const { t } = createI18n('en');

// Plan §11 against the real database: primary and ordered backup teams for a place.
test.describe('coverage backups, as super admin', () => {
  test.use({ storageState: adminState });

  test('adds backups, reorders them, and a backup made primary leaves the list', async ({ page }) => {
    const a = accounts();
    const run = Date.now().toString(36);
    const team = async (name: string) => (await api<{ id: string }>(a.admin.token, 'POST', '/v1/coverage/teams', { name: `${name} ${run}` })).body.id;
    const [p, b1, b2] = [await team('Primary'), await team('Backup one'), await team('Backup two')];
    await api(a.admin.token, 'PUT', '/v1/coverage/assignments', { teamId: p, sites: [a.siteId] });
    try {
      await page.goto('/coverage/places?q=E2E+Gardens');
      const row = page.getByRole('row').filter({ hasText: 'E2E Gardens' });
      const choose = async (name: string, button: string) => {
        await row.getByRole('checkbox').check();
        await page.getByLabel(t('console.coverage.assignTo')).selectOption({ label: `${name} ${run}` });
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(page.getByRole('status')).toHaveText(t('console.coverage.assigned', { count: 1 }));
      };
      await choose('Backup one', t('console.coverage.addBackup'));
      await expect(row).toContainText(`1. Backup one ${run}`);

      await row.getByRole('link', { name: t('console.coverage.editBackupsA11y', { place: 'E2E Gardens' }) }).click();
      await page.getByRole('combobox', { name: t('console.coverage.addBackupTeam') }).selectOption({ label: `Backup two ${run}` });
      await page.getByRole('button', { name: t('console.coverage.add'), exact: true }).click();
      const list = page.getByRole('list', { name: t('console.coverage.backupsTitle', { place: 'E2E Gardens' }) });
      await expect(list.getByRole('listitem')).toHaveCount(2);
      await page.getByRole('button', { name: t('console.coverage.moveUpA11y', { team: `Backup two ${run}` }) }).click();
      await expect(list.getByRole('listitem').first()).toContainText(`Backup two ${run}`);

      // A backup made primary leaves the backup list (a team appears once per place).
      await page.goto('/coverage/places?q=E2E+Gardens');
      await choose('Backup two', t('console.coverage.setPrimary'));
      await expect(row).toContainText(t('console.coverage.primary', { team: `Backup two ${run}` }));
      await expect(row).toContainText(t('console.coverage.backupsLine', { teams: `1. Backup one ${run}` }));
    } finally {
      await api(a.admin.token, 'PUT', '/v1/coverage/assignments', { teamId: null, sites: [a.siteId] });
      for (const id of [p, b1, b2]) await api(a.admin.token, 'PATCH', `/v1/coverage/teams/${id}`, { active: false });
    }
  });
});
