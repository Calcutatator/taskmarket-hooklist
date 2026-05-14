import { expect, test, type Page } from '@playwright/test';

import { startMockApiServer, taskListResponse } from './mock-api';

const clientFailures = new WeakMap<Page, string[]>();
let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

test.beforeAll(async () => {
  mockApi = await startMockApiServer();
  test.info().annotations.push({
    description: 'Mock API started for production UI regression tests.',
    type: 'mock-api',
  });
});

test.afterAll(async () => {
  if (mockApi) {
    await mockApi.close();
  }
});

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  clientFailures.set(page, failures);

  await page.route('**/trpc/**', async (route) => {
    await route.fulfill({
      body: JSON.stringify([
        {
          result: {
            data: taskListResponse,
          },
        },
      ]),
      contentType: 'application/json',
      status: 200,
    });
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      failures.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    failures.push(error.message);
  });
});

test.afterEach(async ({ page }) => {
  expect(clientFailures.get(page) ?? []).toEqual([]);
});

const publicRoutes = [
  { heading: /Fund one task\. Unleash a market of agents\./i, path: '/' },
  { heading: /Open tasks/i, path: '/dashboard/tasks' },
  { heading: /Agent directory/i, path: '/dashboard/agents' },
  { heading: /Humans directory/i, path: '/dashboard/humans' },
  { heading: /Leaderboard/i, path: '/dashboard/leaderboard' },
  { heading: /Task Market Protocol/i, path: '/dashboard/protocol' },
  { heading: /Latest activity/i, path: '/dashboard' },
];

for (const route of publicRoutes) {
  test(`renders ${route.path} without client errors or horizontal overflow`, async ({ page }) => {
    await page.goto(route.path);

    await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error/);

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
  });
}

test('keeps the primary marketplace path navigable from the landing page', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Primary landing nav is hidden on mobile.');

  await page.goto('/');

  await page.getByRole('link', { name: /^Tasks$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(
    page.getByRole('region', { name: /Task list/i }).getByRole('heading', { name: /Open tasks/i })
  ).toBeVisible();
});

test('redirects top-level dashboard aliases to canonical dashboard routes', async ({ page }) => {
  await page.goto('/tasks?status=open');
  await expect(page).toHaveURL(/\/dashboard\/tasks\?status=open$/);
  await expect(
    page.getByRole('region', { name: /Task list/i }).getByRole('heading', { name: /Open tasks/i })
  ).toBeVisible();

  await page.goto('/protocol');
  await expect(page).toHaveURL(/\/dashboard\/protocol$/);
  await expect(page.getByRole('heading', { name: /Task Market Protocol/i })).toBeVisible();
});

test('keeps pending-review detail usable without horizontal overflow', async ({ page }) => {
  await page.goto('/dashboard/tasks/e2e-pending-review');

  await expect(
    page.getByRole('heading', { name: /Bounty - pending requester review/i })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /Submission review/i })).toBeVisible();
  const payoutRequirement = page
    .getByRole('group', { name: /Payout release requirement/i })
    .first();
  await expect(
    payoutRequirement.getByText(/Connect requester wallet to release payout/i)
  ).toBeVisible();
  await expect(payoutRequirement.getByRole('button', { name: /Connect wallet/i })).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test('prioritizes mobile task results and moves filters into a drawer', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only task browse layout.');

  await page.goto('/dashboard/tasks');

  await expect(
    page.getByRole('region', { name: /Task list/i }).getByRole('heading', { name: /Open tasks/i })
  ).toBeVisible();
  await expect(page.getByRole('list', { name: /Task cards/i })).toBeVisible();
  await expect(page.getByRole('complementary', { name: /Task filters/i })).toHaveCount(0);

  const filterButton = page.getByRole('button', { name: /^Filters$/i });
  await expect(filterButton).toBeVisible();

  const triggerBox = await filterButton.boundingBox();
  expect(triggerBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await filterButton.click();
  await expect(page.getByRole('dialog', { name: /Task filters/i })).toBeVisible();

  await page.getByRole('link', { name: /^auction$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/tasks\?mode=auction/);

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test('keeps primary mobile chrome controls at touch size', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only touch target audit.');

  await page.goto('/dashboard/tasks');

  const controls = [
    page.getByRole('button', { name: /Toggle Sidebar/i }),
    page.getByRole('button', { name: /^Filters$/i }),
    page.getByRole('link', { name: /Post task/i }).first(),
  ];

  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
