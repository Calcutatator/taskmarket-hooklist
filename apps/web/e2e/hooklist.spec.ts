import { expect, test } from '@playwright/test';

import { startMockApiServer } from './mock-api';

let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

test.beforeAll(async () => {
  mockApi = await startMockApiServer();
});

test.afterAll(async () => {
  await mockApi.close();
});

test('opens the native Hooklist builder and preserves its explicit draft state', async ({
  page,
}) => {
  await page.goto('/hooks');

  await expect(page.getByRole('heading', { name: 'Lifecycle hooks in use' })).toBeVisible();
  await page.getByRole('link', { name: 'Build a hook' }).click();

  await expect(page).toHaveURL(/\/hooks\/build$/);
  await expect(
    page.getByRole('heading', { name: 'Create an evidence-backed hook package' })
  ).toBeVisible();
  await expect(page.getByText('Draft scaffold')).toBeVisible();
  await expect(page.getByText(/intentionally marked x-draft/i)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    )
    .toBeLessThanOrEqual(1);
});

test('renders the Next 404 for malformed and unobserved Hooklist detail routes', async ({
  page,
}) => {
  await page.goto('/hooks/not-an-address');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();

  await page.goto('/hooks/0x2222222222222222222222222222222222222222');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
