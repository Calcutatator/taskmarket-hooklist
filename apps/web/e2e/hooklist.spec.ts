import { expect, test } from '@playwright/test';

import { startMockApiServer } from './mock-api';

let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;
const canonicalHookAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const mixedCaseHookAddress = '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd';

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
  await page.getByLabel('Deployment chain ID').fill('84532');
  await page.getByLabel('Deployment network').fill('base-sepolia');
  await expect(page.getByLabel('taskmarket-hook.json preview')).toContainText('"chainId": 84532');
  await expect(page.getByLabel('taskmarket-hook.json preview')).toContainText(
    '"network": "base-sepolia"'
  );
  const manifest = JSON.parse(
    (await page.getByLabel('taskmarket-hook.json preview').textContent()) ?? '{}'
  );
  expect(manifest).not.toHaveProperty('gas');
  expect(manifest.deployments[0].gas.estimates.checkFund).toMatchObject({
    maximum: 0,
    methodology: 'DRAFT: gas has not been measured.',
    typical: 0,
  });
  await expect(page.getByLabel('External dependencies JSON array')).toHaveAttribute(
    'placeholder',
    /"chainId":84532/
  );
  await expect(page.getByLabel('Privileged roles JSON array')).toHaveAttribute(
    'placeholder',
    /"chainId":84532/
  );
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

test('redirects mixed-case Hooklist addresses to the lowercase canonical detail URL', async ({
  page,
}) => {
  await page.goto(`/hooks/${mixedCaseHookAddress}`);

  await expect(page).toHaveURL(new RegExp(`/hooks/${canonicalHookAddress}$`));
  await expect(page.getByRole('heading', { name: canonicalHookAddress })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    new RegExp(`/hooks/${canonicalHookAddress}$`)
  );
});
