import { expect, test } from '@playwright/test';

import { startMockApiServer } from './mock-api';

let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

test.beforeAll(async () => {
  mockApi = await startMockApiServer();
});

test.afterAll(async () => {
  await mockApi?.close();
});

test('guides a requester from publication into the action Inbox', async ({ page }) => {
  await page.goto('/dashboard/tasks/mock-bounty-open?published=1');

  await expect(page.getByText('Task published', { exact: true }).first()).toBeVisible();
  await expect(
    page.locator('#dashboard-content').getByText('No action is needed right now', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/When submissions arrive, review them here or from your Inbox/i).first()
  ).toBeVisible();

  await page.getByRole('link', { name: 'Open Inbox' }).first().click();

  await expect(page).toHaveURL(/\/dashboard\/inbox$/);
  await expect(page.getByRole('heading', { name: 'Connect to view your Inbox' })).toBeVisible();
});

test('renders a focused settlement route with per-recipient rating progress', async ({ page }) => {
  await page.goto(
    '/dashboard/tasks/mock-bounty-split-settlement?focus=rate_workers#settlement-payouts'
  );

  await expect(page).toHaveURL(
    /\/dashboard\/tasks\/mock-bounty-split-settlement\?focus=rate_workers#settlement-payouts$/
  );
  await expect(
    page.locator('#dashboard-content').getByText('Rate settlement recipients', { exact: true })
  ).toBeVisible();
  const payouts = page.getByRole('region', { name: 'Settlement payouts' });
  await expect(payouts.getByText('3 winners', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 3 rated').first()).toBeVisible();
  await expect(payouts.getByText('2 USDC', { exact: true })).toBeVisible();
  await expect(payouts.getByText('1.9 USDC', { exact: true })).toBeVisible();
  await expect(payouts.getByText('0.1 USDC', { exact: true })).toBeVisible();
});

test('explains the disconnected Inbox without reporting a personal count', async ({ page }) => {
  await page.goto('/dashboard/inbox');

  await expect(page.getByRole('heading', { name: 'Connect to view your Inbox' })).toBeVisible();
  await expect(
    page.locator('#dashboard-content').getByText('Sign in to see tasks that need your attention.')
  ).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Dashboard actions' }).getByLabel('Inbox')
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /actions? to do/i })).toHaveCount(0);
});

test('keeps market news available as the secondary Inbox view', async ({ page }) => {
  await page.goto('/dashboard/inbox');

  await page.getByRole('tab', { name: 'Market news' }).click();

  await expect(page.getByRole('region', { name: 'Market news' })).toBeVisible();
  await expect(page.getByTestId('market-news-list')).toBeVisible();
});
