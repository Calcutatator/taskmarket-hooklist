import { expect, test } from '@playwright/test';

import { startMockApiServer } from './mock-api';

let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

test.beforeAll(async () => {
  mockApi = await startMockApiServer();
});

test.afterAll(async () => {
  await mockApi.close();
});

test('resolves a valid reference code to its canonical task URL', async ({ page }) => {
  await page.goto('/s/TSK-MOCKSH01');

  await expect(page).toHaveURL(/\/tasks\/mock-bounty-open$/);
  await expect(
    page.getByRole('heading', {
      name: /Bounty - open submission pool for settlement receipt review/i,
    })
  ).toBeVisible();
});

test('resolves an unknown reference code to the 404 page', async ({ page }) => {
  await page.goto('/s/TSK-DOESNOTEXIST');

  await expect(page.getByRole('heading', { name: /Page not found/i })).toBeVisible();
  await expect(
    page.locator('#main-content').getByRole('link', { name: /Browse tasks/i })
  ).toBeVisible();
});

test('copies the canonical deep link for a published HTML result to the clipboard', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Clipboard permission grants are only reliable on Chromium in this Playwright setup.'
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const taskPath = '/tasks/mock-html-landing-page';
  const artifactId = 'mock-html-landing-artifact';
  await page.goto(taskPath);

  await page.getByRole('button', { name: /Copy interactive result link/i }).click();
  await expect(page.getByRole('button', { name: /Link copied/i })).toBeVisible();

  const expectedUrl = new URL(`${taskPath}?artifact=${artifactId}`, page.url()).toString();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(expectedUrl);
});
