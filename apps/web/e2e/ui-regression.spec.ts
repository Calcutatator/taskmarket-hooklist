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
    const url = new URL(route.request().url());
    const procedures = url.pathname
      .replace(/^\/trpc\/?/, '')
      .split(',')
      .filter(Boolean);
    const results = procedures.map((procedure) => ({
      result: {
        data: procedure === 'tasks.list' ? taskListResponse : null,
      },
    }));
    await route.fulfill({
      body: JSON.stringify(results.length > 0 ? results : [{ result: { data: null } }]),
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
  { heading: /Open tasks/i, path: '/tasks' },
  { heading: /^Agents$/i, path: '/agents' },
  { heading: /^Humans$/i, path: '/humans' },
  { heading: /Leaderboard/i, path: '/leaderboard' },
  { heading: /Task Market Protocol/i, path: '/protocol' },
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

  await page
    .getByRole('navigation', { name: /^Primary$/i })
    .getByRole('link', { name: /^Tasks$/i })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole('region', { name: /Task list/i }).getByRole('heading', { name: /Open tasks/i })
  ).toBeVisible();
});

test('keeps the top-level market routes public instead of redirecting them', async ({ page }) => {
  await page.goto('/tasks?status=open');
  await expect(page).toHaveURL(/\/tasks\?status=open$/);
  await expect(
    page.getByRole('region', { name: /Task list/i }).getByRole('heading', { name: /Open tasks/i })
  ).toBeVisible();

  await page.goto('/protocol');
  await expect(page).toHaveURL(/\/protocol$/);
  await expect(page.getByRole('heading', { name: /Task Market Protocol/i })).toBeVisible();
});

test('keeps pending-review detail usable without horizontal overflow', async ({ page }) => {
  await page.goto('/dashboard/tasks/e2e-pending-review');

  await expect(
    page.getByRole('heading', { name: /Bounty - pending requester review/i })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /Submission review/i })).toBeVisible();
  const comparison = page.getByRole('region', { name: /Artifact comparison/i });
  await expect(comparison).toBeVisible();
  await expect(
    comparison.getByRole('button', { name: /Open candidate-a\.png preview/i })
  ).toBeVisible();
  await expect(
    comparison.getByRole('button', { name: /Open candidate-a-demo\.mp4 preview/i })
  ).toBeVisible();
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

test('surfaces the live status banner on an open task and stays hydration-clean', async ({
  page,
}) => {
  await page.goto('/dashboard/tasks/mock-bounty-open');

  const banner = page.getByRole('status', { name: /Task status/i });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Live and broadcasting to the network/i);

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test('hides the live status banner on a terminal task', async ({ page }) => {
  await page.goto('/dashboard/tasks/mock-cancelled');

  await expect(page.getByRole('status', { name: /Task status/i })).toHaveCount(0);
});

test('collapses the desktop sidebar to an icon rail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop-only sidebar rail behavior.');

  await page.goto('/dashboard/tasks');

  const sidebar = page.locator('[data-slot="sidebar"]').first();
  const sidebarContainer = page.locator('[data-slot="sidebar-container"]').first();
  const sidebarTrigger = page.getByRole('button', { name: /Toggle Sidebar/i });

  await expect(sidebar).toHaveAttribute('data-state', 'expanded');
  await expect(page.getByRole('link', { name: /Taskmarket/i })).toBeVisible();
  await sidebarTrigger.click();

  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await expect(sidebar).toHaveAttribute('data-collapsible', 'icon');
  const brandLabelBox = await page.getByText('Taskmarket', { exact: true }).boundingBox();
  expect(brandLabelBox?.width ?? 0).toBeLessThanOrEqual(1);
  expect(brandLabelBox?.height ?? 0).toBeLessThanOrEqual(1);
  await expect(page.getByRole('link', { name: /^Task modes$/i })).toBeVisible();

  await expect
    .poll(async () => {
      const box = await sidebarContainer.boundingBox();
      return box?.width ?? 0;
    })
    .toBeLessThanOrEqual(72);
  const railBox = await sidebarContainer.boundingBox();
  expect(railBox?.x ?? -1).toBeGreaterThanOrEqual(-1);
  expect(railBox?.width ?? 0).toBeGreaterThanOrEqual(40);
  expect(railBox?.width ?? 0).toBeLessThanOrEqual(72);

  await page.getByRole('link', { name: /^Task modes$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/task-types$/);
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');

  await page.reload();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await expect(sidebar).toHaveAttribute('data-collapsible', 'icon');

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
  await expect(page.getByRole('list', { name: /Task (cards|gallery)/i })).toBeVisible();
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
