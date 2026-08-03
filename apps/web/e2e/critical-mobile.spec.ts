import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  isWebKitMediaControlIconLoadError,
  isWebKitRscPrefetchAccessControlError,
} from './client-errors';
import { startMockApiServer, taskListResponse } from './mock-api';

const clientFailures = new WeakMap<Page, string[]>();
let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectInsideViewport(locator: Locator) {
  const bounds = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      viewportWidth: window.innerWidth,
    };
  });

  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(bounds.top).toBeGreaterThanOrEqual(-1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight + 1);
}

async function expectFullyOpaque(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        let opacity = 1;
        let current: Element | null = element;
        while (current) {
          opacity *= Number(getComputedStyle(current).opacity);
          current = current.parentElement;
        }
        return opacity;
      })
    )
    .toBe(1);
}

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
}

async function expectStablePage(page: Page, keyContent: Locator) {
  await expectFullyOpaque(keyContent);
  await expect(page.getByText(/^Loading tasks$/i)).toHaveCount(0);
  await expect(page.getByRole('list', { name: /Loading task gallery/i })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
}

test.beforeAll(async () => {
  mockApi = await startMockApiServer();
});

test.afterAll(async () => {
  if (mockApi) {
    await mockApi.close();
  }
});

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Critical edge-width mobile coverage.');

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
      const text = message.text();
      if (isWebKitRscPrefetchAccessControlError(testInfo.project.name, text)) {
        return;
      }
      if (isWebKitMediaControlIconLoadError(testInfo.project.name, text)) {
        return;
      }
      failures.push(text);
    }
  });
  page.on('pageerror', (error) => {
    failures.push(error.message);
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.project.name.includes('mobile')) {
    expect(clientFailures.get(page) ?? []).toEqual([]);
  }
});

test('navigates and closes the public mobile menu by Escape, backdrop, and link', async ({
  page,
}) => {
  await page.goto('/');
  await expectStablePage(
    page,
    page.getByRole('heading', { name: /Fund one task\. Unleash a market of agents\./i })
  );

  const openMenu = page.getByRole('button', { name: /Open menu/i });
  await expectTouchTarget(openMenu);
  await openMenu.click();

  const menu = page.getByRole('dialog', { name: /Menu/i });
  await expect(menu).toBeVisible();
  await expectTouchTarget(menu.getByRole('link', { name: /^Tasks$/i }));
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await openMenu.click();
  await expect(menu).toBeVisible();
  await page.locator('[data-slot="sheet-overlay"]').click({ position: { x: 4, y: 4 } });
  await expect(menu).toBeHidden();

  await openMenu.click();
  await menu.getByRole('link', { name: /^Agents$/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/agents$/);
  await expect(menu).toBeHidden();
  await expectStablePage(page, page.getByRole('heading', { name: /Agent directory/i }).last());
});

test('navigates dashboard sections without document reload and preserves browser history', async ({
  page,
}) => {
  await page.goto('/dashboard', { waitUntil: 'networkidle' });
  const sections = page.getByRole('navigation', { name: /Dashboard sections/i });
  const overview = sections.getByRole('link', { name: /^Overview$/i });
  const activity = sections.getByRole('link', { name: /^Activity$/i });
  const tasks = sections.getByRole('link', { name: /^Tasks$/i });
  await page.evaluate(() => {
    window.sessionStorage.setItem('dashboard-beforeunload', 'false');
    window.addEventListener(
      'beforeunload',
      () => window.sessionStorage.setItem('dashboard-beforeunload', 'true'),
      { once: true }
    );
  });

  await expect(overview).toHaveAttribute('aria-current', 'page');
  await expectTouchTarget(activity);
  await expectStablePage(
    page,
    page.getByRole('heading', { name: /Marketplace overview/i }).first()
  );

  await activity.click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/dashboard\?section=activity$/);
  await expect(activity).toHaveAttribute('aria-current', 'page');
  await expectStablePage(
    page,
    page.getByRole('heading', { name: /Marketplace activity/i }).first()
  );
  await activity.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('dashboard-beforeunload')))
    .toBe('false');

  await tasks.evaluate((element: HTMLAnchorElement) => element.click());
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/dashboard\?section=tasks$/);
  await expect(tasks).toHaveAttribute('aria-current', 'page');
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem('dashboard-beforeunload')))
    .toBe('false');

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\?section=activity$/);
  await expect(page.getByRole('heading', { name: /Marketplace activity/i }).first()).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: /Dashboard sections/i })
      .getByRole('link', { name: /^Activity$/i })
  ).toHaveAttribute('aria-current', 'page');

  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard\?section=tasks$/);
  await expect(tasks).toHaveAttribute('aria-current', 'page');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(tasks).toHaveAttribute('aria-current', 'page');
  await page.waitForLoadState('networkidle');
});

test('persists task views while resetting cursor pagination through reload and history', async ({
  page,
}) => {
  await page.goto('/tasks?mode=auction&status=open&cursor=next-page&cursorStack=first-page');
  const filters = page.getByRole('button', { name: /^Filters/i });
  const listView = page.getByRole('link', { name: /List view/i });
  const galleryView = page.getByRole('link', { name: /Gallery view/i });

  // The compact card feed is the deterministic default on every viewport, so the
  // server output remains in place after hydration when no explicit view is present.
  await expect(page.getByRole('list', { name: /Task cards/i })).toBeVisible();
  await expect(listView).toHaveAttribute('aria-current', 'page');
  await expect(listView).toHaveAttribute('href', '/tasks?mode=auction&status=open');
  await expect(galleryView).toHaveAttribute('href', '/tasks?mode=auction&status=open&view=gallery');
  await expectTouchTarget(filters);
  await expectTouchTarget(listView);
  await expectTouchTarget(galleryView);

  // Gallery is an explicit URL-backed preference. Selecting it clears both cursor
  // parameters, and the preference survives a reload.
  await galleryView.click();
  await expect(page).toHaveURL(/\/tasks\?mode=auction&status=open&view=gallery$/);
  await expect(page.getByRole('list', { name: /Task gallery/i })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('list', { name: /Task gallery/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Gallery view/i })).toHaveAttribute(
    'aria-current',
    'page'
  );

  // Filter navigation keeps the explicit gallery preference.
  await filters.click();
  const filterDialog = page.getByRole('dialog', { name: /Task filters/i });
  await expect(filterDialog).toBeVisible();
  const modeFilter = filterDialog.getByRole('button', { name: /Mode: Auction/i });
  await modeFilter.focus();
  await page.keyboard.press('Enter');
  const bountyMode = page.getByRole('menuitem', { name: /^Bounty$/i });
  await expect(bountyMode).toHaveAttribute('href', '/tasks?mode=bounty&status=open&view=gallery');
  await bountyMode.click();
  await expect(page).toHaveURL(/\/tasks\?mode=bounty&status=open&view=gallery$/);
  await page.locator('[data-slot="drawer-overlay"]').click({ position: { x: 4, y: 4 } });
  await expect(filterDialog).toBeHidden();
  await expect(filters).toBeFocused();
  await expect(page.getByRole('list', { name: /Task gallery/i })).toBeVisible();

  // Browser history restores the previous explicit gallery state, then List returns
  // to the clean default URL without a hydration-time feed swap.
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?mode=auction&status=open&view=gallery$/);
  await expect(page.getByRole('list', { name: /Task gallery/i })).toBeVisible();
  const restoredListView = page.getByRole('link', { name: /List view/i });
  await expect(restoredListView).toHaveAttribute('href', '/tasks?mode=auction&status=open');
  await restoredListView.evaluate((element: HTMLAnchorElement) => element.click());
  await expect(page).toHaveURL(/\/tasks\?mode=auction&status=open$/);
  await expect(page.getByRole('list', { name: /Task cards/i })).toBeVisible();
  await expectStablePage(page, page.getByRole('heading', { name: /Open tasks/i }).first());
});

test('shows one provider-missing task action without opening upload', async ({ page }) => {
  await page.goto('/tasks/mock-bounty-open');
  const participation = page.getByTestId('task-participation');
  const unavailable = participation.getByRole('button', { name: /Sign in unavailable/i });

  await expectTouchTarget(unavailable);
  await expect(unavailable).toBeDisabled();
  await expect(
    participation.getByRole('button', { name: /Connect wallet to upload/i })
  ).toHaveCount(0);
  await expect(participation.getByRole('button', { name: /^Upload files$/i })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /Submit work/i })).toHaveCount(0);
  await expectStablePage(
    page,
    page.getByRole('heading', { name: /Bounty - open submission pool/i })
  );
});

test('keeps grouped submission review usable at edge mobile widths', async ({ page }) => {
  await page.goto('/dashboard/tasks/e2e-grouped-submission-review');

  const comparison = page.getByRole('region', { name: /Artifact comparison/i });
  const historyButton = comparison.getByRole('button', {
    name: /^View all 150 submissions from/,
  });
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { exact: true, name: 'Gallery' }).tap();
  const artifactDrawer = page.getByRole('dialog');
  await expect(artifactDrawer).toContainText(
    'second-worker-final-with-an-extremely-long-review-filename.png'
  );
  await expect(artifactDrawer).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press('Escape');
  await expect(artifactDrawer).toHaveCount(0);

  await page.getByRole('button', { name: 'Next page' }).tap();
  await expectTouchTarget(historyButton);
  await historyButton.tap();
  await expect(page.getByRole('heading', { name: 'Submitter history' })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Submission \d+ of 150 from/ })).toHaveCount(10);
  await expectNoHorizontalOverflow(page);

  const backButton = page.getByRole('button', { name: 'Back to all submitters' });
  await expectTouchTarget(backButton);
  await backButton.tap();
  await expect(comparison).toBeVisible();
});

test('explains estimated DREAMS eligibility within the mobile viewport', async ({ page }) => {
  await page.goto('/tasks/mock-bounty-open');

  const metrics = page.getByRole('region', { name: /Task metrics/i });
  await expect(metrics.getByText('Estimated DREAMS bonus', { exact: true })).toBeVisible();

  const trigger = metrics.getByRole('button', {
    name: /Learn how DREAMS bonus eligibility works/i,
  });
  await expectTouchTarget(trigger);
  await trigger.tap();

  const details = page.getByRole('dialog', {
    name: /How estimated DREAMS bonuses work/i,
  });
  await expect(details).toBeVisible();
  await expect(details).toContainText(
    "Wallet age starts with the recipient's first interaction with the DREAMS reward hook, not when the wallet was created."
  );
  await expect(details).toContainText('under 2 weeks earns 0%');
  await expect(details).toContainText('2–4 weeks earns 25%');
  await expect(details).toContainText('4–8 weeks earns 50%');
  await expect(details).toContainText('8+ weeks earns 100%');
  await expect(details).toContainText(
    'Weekly global, worker, requester, and task caps can reduce or skip the bonus.'
  );
  await expect(details).toContainText("The task's USDC reward is unaffected.");
  await expect(details).toContainText(
    'Credited DREAMS become claimable and are not sent automatically.'
  );
  await expect(
    details.getByRole('link', {
      name: /Read the DREAMS reward rules/i,
    })
  ).toHaveAttribute('href', 'https://docs.taskmarket.dev/reference/rewards');

  await expectInsideViewport(details);
  await expectNoHorizontalOverflow(page);

  await trigger.tap();
  await expect(details).toBeHidden();
});

test('keeps task creation steps usable without a configured wallet provider', async ({ page }) => {
  await page.goto('/dashboard/tasks/new');
  await expectStablePage(page, page.getByRole('heading', { name: /Fund a task/i }).first());

  const writeBrief = page.getByRole('button', { name: /Write the brief/i });
  await expectTouchTarget(writeBrief);
  await writeBrief.click();
  await expect(page.getByRole('heading', { name: /Write the brief/i })).toBeVisible();

  await page
    .getByLabel(/Description/i)
    .fill('Produce a concise accessibility audit with evidence and clear acceptance criteria.');
  await page.getByLabel(/^Reward/i).fill('25');
  const continueToDrop = page.getByRole('button', { name: /Continue to Task Drop/i });
  await expectTouchTarget(continueToDrop);
  await continueToDrop.click();

  await expect(page.getByRole('heading', { name: /Choose a Task Drop/i })).toBeVisible();
  const continueToPublish = page.getByRole('button', { name: /Continue to publish/i });
  await expectTouchTarget(continueToPublish);
  await continueToPublish.click();
  await expect(page.getByRole('heading', { name: /Review and publish/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect wallet to post/i })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

test('keeps reduced-motion proof content static and visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/try');

  const heading = page.getByRole('heading', { name: /A custom infographic for \$1\./i });
  await expectStablePage(page, heading);
  await expect
    .poll(() =>
      page
        .locator('.try-drop-strip')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName)
    )
    .toBe('none');
  await expect(page.locator('.try-drop-track-group[data-duplicate="true"]').first()).toHaveCSS(
    'display',
    'none'
  );
});
