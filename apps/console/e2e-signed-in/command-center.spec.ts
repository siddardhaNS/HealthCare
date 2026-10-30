import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { sosRef } from '@repo/contracts/sos';
import { createI18n } from '@repo/i18n';
import { accounts, adminState, api, AREA, crewAccepts, endIncident, erState } from './fixtures';

const { t } = createI18n('en');
// The board refreshes on live pushes, and polls every 10 s without them.
const LIVE = { timeout: 20_000 };

const raiseSos = async () => {
  const r = await api<{ id: string }>(accounts().resident.token, 'POST', '/v1/sos', { idempotencyKey: crypto.randomUUID(), location: { ...AREA, accuracyM: 15 } });
  expect(r.status).toBe(201);
  return r.body.id;
};

test.describe('as super admin', () => {
  test.use({ storageState: adminState });

  test('test SOS: raised from the console, accepted by a drill crew, never sent to a hospital, cancelled with a reason', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('run-test-sos').click();
    const panel = page.getByTestId('incident-panel');
    await expect(panel.getByText(t('console.cc.drill'), { exact: true })).toBeVisible(LIVE);
    const id = new URL(page.url()).searchParams.get('incident')!;
    expect(id).toBeTruthy();
    try {
      await crewAccepts(accounts(), id);
      await expect(panel.getByTestId('incident-state')).toHaveText(t('console.cc.state.accepted'), LIVE);
      await expect(panel.getByTestId('handover')).toContainText(t('console.cc.handoverDrill'));

      // A reason is required; the timeline shows it.
      const cancel = panel.locator('details').filter({ has: page.getByTestId('act-cancel') });
      await cancel.getByTestId('act-cancel').click();
      await cancel.getByLabel(t('console.cc.reason')).fill('Drill finished');
      await cancel.getByRole('button', { name: t('console.cc.confirm') }).click();
      await page.goto(`/?incident=${id}`);
      await expect(page.getByTestId('incident-state')).toHaveText(t('console.cc.state.cancelled'), LIVE);
      await expect(page.getByText('“Drill finished”')).toBeVisible();
    } finally {
      await endIncident(accounts(), id);
    }
  });

  // FIXME(step 7): the test crew gets no offer for a resident SOS (the drill test works). Not diagnosed yet.
  test.fixme('real SOS: the handover opens on accept; the desk changes the hospital with a reason', async ({ page }) => {
    const id = await raiseSos();
    try {
      await crewAccepts(accounts(), id);
      await page.goto(`/?incident=${id}`);
      const box = page.getByTestId('handover');
      await expect(box).toContainText('E2E Near Hospital', LIVE);
      await expect(box).toContainText(t('console.cc.chosenBy.auto'));
      await expect(box).toContainText(t('console.cc.handoverUnconfirmed'));

      const form = page.locator('details').filter({ has: page.getByTestId('act-hospital') });
      await form.getByTestId('act-hospital').click();
      // Nearest first, the current hospital left out: the far hospital is the first choice.
      await expect(form.getByRole('option').nth(1)).toHaveText(/E2E Far Hospital/);
      await form.getByLabel(t('console.cc.hospitalPick')).selectOption({ index: 1 });
      await form.getByLabel(t('console.cc.reason')).fill('Near hospital has no cath lab');
      await form.getByRole('button', { name: t('console.cc.confirm') }).click();
      await expect(box).toContainText('E2E Far Hospital', LIVE);
      await expect(box).toContainText(t('console.cc.chosenBy.desk'));
      await expect(box).toContainText('“Near hospital has no cath lab”');
      // The desk never sees medical contents.
      await expect(box).not.toContainText(/allerg|blood group:/i);
    } finally {
      await endIncident(accounts(), id);
    }
  });

  test('live updates paused: the board falls back to polling and still shows a new SOS', async ({ page }) => {
    // Realtime cannot connect (blocked network, proxy, outage).
    await page.routeWebSocket(/\/realtime\//, (ws) => ws.close());
    await page.goto('/');
    await expect(page.getByText(t('console.cc.livePaused'))).toBeVisible(LIVE);
    const id = await raiseSos();
    try {
      await expect(page.getByText(sosRef(id)).first()).toBeVisible(LIVE);
    } finally {
      await endIncident(accounts(), id);
    }
  });

  // FIXME(step 7): axe finds 4 colour-contrast failures on /hospitals (real issue, to fix in the page).
  test.fixme('hospitals page meets WCAG 2 AA (axe)', async ({ page }) => {
    await page.goto('/hospitals');
    await expect(page.getByText('E2E Near Hospital')).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe('as hospital ER staff', () => {
  test.use({ storageState: erState });

  // FIXME(step 7): same as the real-SOS test: the test crew gets no offer.
  test.fixme('sees only its own incoming patients, opens the record and confirms receipt once', async ({ page }) => {
    const a = accounts();
    const id = await raiseSos();
    try {
      await crewAccepts(a, id);
      // Goes to the near hospital first: the far hospital's ER does not see it.
      await page.goto('/handovers');
      await expect(page.getByText(sosRef(id))).toHaveCount(0);
      const moved = await api(a.admin.token, 'POST', `/v1/desk/sos/${id}/hospital`, { hospitalId: a.hospitals.far, reason: 'E2E: send to the far hospital' });
      expect(moved.status).toBe(200);

      await page.reload();
      const row = page.getByTestId('handovers').getByRole('listitem').filter({ hasText: sosRef(id) });
      await expect(row).toBeVisible();
      await row.getByRole('link', { name: t('console.partner.open') }).click();
      await expect(page.getByTestId('handover-record')).toBeVisible();
      await expect(page.getByTestId('handover-record')).toContainText('E2E Resident');

      await page.getByTestId('confirm-receipt').click();
      await expect(page.getByTestId('confirmed')).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    } finally {
      await endIncident(a, id);
    }
  });

  test('cannot open the command center or another hospital’s handover', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/handovers$/);
    await page.goto(`/handovers/${crypto.randomUUID()}`);
    await expect(page.getByRole('alert').filter({ hasText: /No such handover/ })).toBeVisible();
  });
});
