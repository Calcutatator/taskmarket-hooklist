import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { RELEASE_BUDGETS_MS, RELEASE_FIXTURE_DELAYS_MS } from './release-budgets';

const mockApiUrl = `http://127.0.0.1:${process.env.SLAP_CHOP_E2E_API_PORT ?? 3107}`;
const releaseScenarioUrl = `${mockApiUrl}/test/release-scenario`;

type ReleaseScenario = {
  artifact?: {
    delayMs?: number;
    status?: number;
  };
  catalog?: {
    delayMs?: number;
    status?: number;
  };
};

async function resetReleaseScenario(request: APIRequestContext) {
  const response = await request.post(`${releaseScenarioUrl}/reset`);

  expect(response.ok()).toBe(true);
}

async function configureReleaseScenario(request: APIRequestContext, scenario: ReleaseScenario) {
  const response = await request.post(releaseScenarioUrl, { data: scenario });

  expect(response.ok()).toBe(true);
}

function expectWithinBudget(label: string, startedAt: number, budgetMs: number) {
  const elapsedMs = Date.now() - startedAt;

  expect(
    elapsedMs,
    `${label} took ${elapsedMs}ms, over its ${budgetMs}ms release budget`
  ).toBeLessThanOrEqual(budgetMs);
}

async function expectFocusIndicator(locator: Locator) {
  await expect(locator).toBeFocused();
  await expect
    .poll(() => locator.evaluate((element) => getComputedStyle(element).outlineStyle))
    .toBe('solid');
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    )
    .toBe(true);
}

test.beforeEach(async ({ request }) => {
  await resetReleaseScenario(request);
});

test.afterEach(async ({ request }) => {
  await resetReleaseScenario(request);
});

test('ships the narrow non-embedding and capability headers without a Privy-breaking source CSP', async ({
  request,
}) => {
  for (const path of ['/', '/games/silent-orbit']) {
    const response = await request.get(path);
    const headers = response.headers();

    expect(response.ok()).toBe(true);
    expect(headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['permissions-policy']).toContain('payment=()');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
  }
});

test('meets the first catalog render and eager square-cover release budgets', async ({ page }) => {
  const startedAt = Date.now();

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const catalog = page.getByRole('list', { name: 'Games by popularity' });
  const tiles = catalog.getByRole('listitem');
  const eagerCovers = catalog.locator('img[fetchpriority="high"][loading="eager"]');
  const silentOrbitCover = page.getByRole('img', { name: 'Cover art for Silent Orbit' });
  const failingCover = page.getByRole('img', { name: 'Cover art for Solar Orbit 8' });

  await expect(tiles).toHaveCount(48);
  await expect(page.getByRole('link', { name: 'Play Silent Orbit, score +59' })).toBeVisible();
  expectWithinBudget(
    'first 48-tile catalog render',
    startedAt,
    RELEASE_BUDGETS_MS.catalogFirstRender
  );

  await expect(eagerCovers).toHaveCount(8);
  await expect(failingCover).toHaveAttribute('fetchpriority', 'high');
  await expect(failingCover).toHaveAttribute('loading', 'eager');
  await expect
    .poll(() =>
      silentOrbitCover.evaluate(
        (image) =>
          image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.naturalHeight > 0
      )
    )
    .toBe(true);

  await expect(
    page.getByRole('img', { name: 'Cover unavailable for Solar Orbit 8' })
  ).toBeVisible();

  const firstTile = tiles.first();
  const size = await firstTile.evaluate((tile) => {
    const bounds = tile.getBoundingClientRect();

    return { height: bounds.height, width: bounds.width };
  });

  expect(Math.abs(size.width - size.height)).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);
});

test('filters 48 catalog entries within the release budget and keeps keyboard focus visible', async ({
  page,
}) => {
  await page.goto('/');

  const home = page.getByRole('link', { name: 'Slap-Chop Games home' });
  const search = page.getByRole('search').getByLabel('Search games');
  const catalog = page.locator('#catalog-results');

  await page.keyboard.press('Tab');
  await expectFocusIndicator(home);
  await page.keyboard.press('Tab');
  await expectFocusIndicator(search);

  const startedAt = Date.now();
  await search.fill('Solar Orbit 48');
  await expect(catalog.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Play Solar Orbit 48, score +12' })).toBeVisible();
  expectWithinBudget('48-item catalog search', startedAt, RELEASE_BUDGETS_MS.catalogSearchAcross48);

  await search.fill('');
  await expect(catalog.getByRole('listitem')).toHaveCount(48);
  await page.keyboard.press('Tab');

  const firstGame = page.getByRole('link', { name: 'Play Silent Orbit, score +59' });
  await expectFocusIndicator(firstGame);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/games\/silent-orbit$/);
  await expect(page.getByRole('button', { name: 'Back to catalog' })).toBeVisible();
});

test('keeps player loading, startup, and terminal failure states bounded', async ({
  page,
  request,
}) => {
  await configureReleaseScenario(request, {
    artifact: { delayMs: RELEASE_FIXTURE_DELAYS_MS.artifact },
  });

  const startupStartedAt = Date.now();
  await page.goto('/games/silent-orbit', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Loading game' })).toBeVisible();
  expectWithinBudget('player loading feedback', startupStartedAt, RELEASE_BUDGETS_MS.playerLoading);
  await expect(page.getByTitle('Silent Orbit game')).toBeVisible();
  expectWithinBudget('verified player startup', startupStartedAt, RELEASE_BUDGETS_MS.playerStartup);

  await configureReleaseScenario(request, {
    artifact: { delayMs: RELEASE_FIXTURE_DELAYS_MS.artifact, status: 503 },
  });

  const failureStartedAt = Date.now();
  await page.goto('/games/silent-orbit', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Loading game' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Game file unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh game link' })).toBeEnabled();
  expectWithinBudget(
    'player terminal failure feedback',
    failureStartedAt,
    RELEASE_BUDGETS_MS.playerFailure
  );
});

test('keeps catalog failures bounded and responsive at desktop and phone viewports', async ({
  page,
  request,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const catalog = page.getByRole('list', { name: 'Games by popularity' });
  const expectedColumns = testInfo.project.name === 'mobile-chromium' ? 2 : 6;
  const columnCount = await catalog.evaluate(
    (grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
  );

  expect(columnCount).toBe(expectedColumns);
  await expectNoHorizontalOverflow(page);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto'
  );

  await configureReleaseScenario(request, {
    catalog: { delayMs: RELEASE_FIXTURE_DELAYS_MS.catalog, status: 503 },
  });

  const failureStartedAt = Date.now();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'The catalog paused.' })).toBeVisible();
  await expect(page.getByText('The catalog cannot reach Taskmarket right now.')).toBeVisible();
  expectWithinBudget(
    'catalog failure feedback',
    failureStartedAt,
    RELEASE_BUDGETS_MS.catalogFailure
  );
});
