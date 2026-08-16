import { expect, test } from '@playwright/test';

test('keeps the private curator workspace fail closed without configured Privy identity', async ({
  page,
}) => {
  let curationRequests = 0;
  await page.route('**/api/games/curation/**', async (route) => {
    curationRequests += 1;
    await route.fulfill({ body: '{}', contentType: 'application/json', status: 500 });
  });

  await page.goto('/curate');

  await expect(page).toHaveTitle(/Curate/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.getByRole('heading', { name: 'Curator access unavailable' })).toBeVisible();
  await expect(page.getByLabel('Task URL or ID')).toHaveCount(0);
  expect(curationRequests).toBe(0);
});
