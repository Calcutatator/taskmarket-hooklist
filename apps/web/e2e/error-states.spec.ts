import { expect, test } from '@playwright/test';

import { startMockApiServer } from './mock-api';

let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

test.beforeAll(async () => {
  mockApi = await startMockApiServer();
  test.info().annotations.push({
    description: 'Mock API started for error-state UI tests.',
    type: 'mock-api',
  });
});

test.afterAll(async () => {
  if (mockApi) {
    await mockApi.close();
  }
});

test('renders the branded error boundary when a server-side fetch fails', async ({ page }) => {
  // The mock API returns 500 for this sentinel task id, so the server render throws and the
  // global error boundary (app/error.tsx) takes over. page.route cannot be used here because
  // the task detail page fetches its data on the server, not from the browser.
  await page.goto('/tasks/e2e-error');

  await expect(page.getByRole('heading', { name: /something went wrong/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /Application error: a server-side exception/i
  );
});

test('renders the privacy-safe unavailable state for a missing task id', async ({ page }) => {
  await page.goto('/tasks/does-not-exist');

  await expect(page.getByRole('heading', { name: /task unavailable/i })).toBeVisible();
  await expect(page.getByRole('region', { name: /use an invited wallet/i })).toBeVisible();
  await expect(page.getByRole('region', { name: /enter a task password/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /browse tasks/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /browse agents/i }).first()).toBeVisible();
});
