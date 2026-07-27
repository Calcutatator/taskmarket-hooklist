import { expect, test, type Locator, type Page } from '@playwright/test';

import { startMockApiServer } from './mock-api';

let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

async function installFirstVisibilityProbe(page: Page, key: string, selector: string) {
  await page.addInitScript(
    ({ probeKey, probeSelector }) => {
      const samples = ((
        window as unknown as { __firstVisibility?: Record<string, number> }
      ).__firstVisibility ??= {});

      const capture = () => {
        if (samples[probeKey] !== undefined) {
          return;
        }

        const element = document.querySelector(probeSelector);
        if (!element) {
          return;
        }

        let opacity = 1;
        let current: Element | null = element;
        while (current) {
          opacity *= Number(getComputedStyle(current).opacity);
          current = current.parentElement;
        }
        samples[probeKey] = opacity;
      };

      new MutationObserver(capture).observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      document.addEventListener('DOMContentLoaded', capture, { once: true });
    },
    { probeKey: key, probeSelector: selector }
  );
}

async function expectVisibleOnFirstPaint(page: Page, key: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (probeKey) =>
          (window as unknown as { __firstVisibility?: Record<string, number> }).__firstVisibility?.[
            probeKey
          ],
        key
      )
    )
    .toBe(1);
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

async function expectLandingFirstPaint(page: Page) {
  await page.goto('/');

  const heading = page.getByRole('heading', {
    name: /Fund one task\. Unleash a market of agents\./i,
  });
  const hero = heading.locator('xpath=ancestor::section');
  const earnUsdc = hero.getByRole('link', { name: /^Earn USDC now$/i });
  const postTask = hero.getByRole('link', { name: /^Post a task$/i });

  await expectFullyOpaque(heading);
  await expectFullyOpaque(earnUsdc);
  await expectFullyOpaque(postTask);
}

test.beforeAll(async () => {
  mockApi = await startMockApiServer();
});

test.afterAll(async () => {
  await mockApi.close();
});

test('keeps the landing promise and primary actions visible after hydration', async ({ page }) => {
  await installFirstVisibilityProbe(page, 'landing-title', '[data-motion="landing-hero-title"]');
  await installFirstVisibilityProbe(
    page,
    'landing-actions',
    '[data-motion="landing-hero-actions"]'
  );
  await expectLandingFirstPaint(page);
  await expectVisibleOnFirstPaint(page, 'landing-title');
  await expectVisibleOnFirstPaint(page, 'landing-actions');
});

test('keeps the landing promise and primary actions static under reduced motion', async ({
  page,
}) => {
  const hydrationFailures: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.text().includes('server rendered HTML') &&
      message.text().includes("didn't match")
    ) {
      hydrationFailures.push(message.text());
    }
  });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expectLandingFirstPaint(page);
  expect(hydrationFailures).toEqual([]);
});

test('keeps dashboard metrics and chart content visible after hydration', async ({ page }) => {
  await installFirstVisibilityProbe(
    page,
    'dashboard-metric',
    '[aria-label="Marketplace metrics"] dd span:first-child'
  );
  await installFirstVisibilityProbe(page, 'dashboard-chart', '.recharts-area-area');
  await page.goto('/dashboard');

  const metrics = page.getByRole('region', { name: /Marketplace metrics/i });
  await expectFullyOpaque(metrics.getByText('Tasks created', { exact: true }));
  await expectFullyOpaque(metrics.getByText('Weekly active agents', { exact: true }));
  await expectFullyOpaque(metrics.locator('dd').first());
  await expectVisibleOnFirstPaint(page, 'dashboard-metric');

  await page.goto('/dashboard?section=activity');
  const activity = page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('.recharts-area-area') });
  await expectFullyOpaque(activity);
  await expect(activity.locator('.recharts-area-area')).toHaveCount(2);
  await expectVisibleOnFirstPaint(page, 'dashboard-chart');
});
