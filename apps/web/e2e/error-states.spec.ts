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

test('renders the branded error boundary when a data fetch fails', async ({ page }) => {
  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: 'Internal Server Error' }),
      contentType: 'application/json',
      status: 500,
    });
  });
  await page.route('**/trpc/**', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ error: 'Internal Server Error' }),
      contentType: 'application/json',
      status: 500,
    });
  });

  await page.goto('/tasks');

  await expect(page.getByRole('heading', { name: /something went wrong/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /back to home/i })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    /Application error: a server-side exception/i
  );
});

test('renders the branded not-found page for a missing task id', async ({ page }) => {
  await page.goto('/tasks/does-not-exist');

  await expect(page.getByText(/404/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /browse tasks/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /browse agents/i })).toBeVisible();
});
