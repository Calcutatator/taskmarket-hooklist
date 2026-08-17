import { expect, test } from '@playwright/test';

test('returns from a verified game route to the exact catalog query and scroll position', async ({
  page,
}) => {
  await page.goto('/?q=arcade');
  await expect(page.getByRole('link', { name: 'Play Solar Orbit 37, score +23' })).toBeVisible();

  await page.getByRole('link', { name: 'Play Solar Orbit 37, score +23' }).scrollIntoViewIfNeeded();
  const scrollBeforeLaunch = await page.evaluate(() => window.scrollY);

  await page.getByRole('link', { name: 'Play Solar Orbit 37, score +23' }).click();

  await expect(page).toHaveURL(/\/games\/solar-orbit-37\?q=arcade$/);
  const iframe = page.getByTitle('Solar Orbit 37 game');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(iframe).toHaveAttribute('allow', '');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(iframe).toHaveAttribute('sandbox', /^(?!.*allow-same-origin)(?!.*allow-popups).*$/);
  const srcDoc = await iframe.getAttribute('srcdoc');
  expect(srcDoc).toContain("connect-src 'none'");
  expect(srcDoc).toContain(
    "script-src 'unsafe-inline' https://cdn.jsdelivr.net/npm/three@0.185.1/"
  );
  expect(srcDoc).not.toMatch(/(?:https?:\/\/(?!cdn\.jsdelivr\.net\/npm\/three@0\.185\.1\/)|wss?:)/);

  await page.getByRole('button', { name: 'Back to catalog' }).click();

  await expect(page).toHaveURL(/\/?q=arcade$/);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), {
      message: 'catalog scroll restored after Back',
    })
    .toBeGreaterThanOrEqual(scrollBeforeLaunch - 2);
});

test('returns to a query created by client-side search before launching a game', async ({
  page,
}) => {
  await page.goto('/');

  const search = page.getByRole('search').getByLabel('Search games');
  await search.fill('Solar Orbit 37');
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === 'Solar Orbit 37');

  await page.getByRole('link', { name: 'Play Solar Orbit 37, score +23' }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === '/games/solar-orbit-37' && url.searchParams.get('q') === 'Solar Orbit 37'
  );
  await expect(page.getByTitle('Solar Orbit 37 game')).toBeVisible();

  await page.getByRole('button', { name: 'Back to catalog' }).click();

  await expect(page).toHaveURL(
    (url) => url.pathname === '/' && url.searchParams.get('q') === 'Solar Orbit 37'
  );
  await expect(search).toHaveValue('Solar Orbit 37');
  await expect(page.getByRole('link', { name: 'Play Solar Orbit 37, score +23' })).toBeVisible();
});

test('uses the catalog root for a direct game entry and ignores stale same-slug session storage', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      'slap-chop-games:game-launch',
      JSON.stringify({
        createdAt: Date.now(),
        launchId: 'stale-same-slug',
        returnHref: '/?q=stale',
        scrollY: 999,
        sourceHistoryLength: 1,
        state: 'claimed',
        slug: 'silent-orbit',
        version: 1,
      })
    );
  });

  await page.goto('/games/silent-orbit?q=arcade');
  await expect(page.getByTitle('Silent Orbit game')).toBeVisible();

  await page.getByRole('button', { name: 'Back to catalog' }).click();

  await expect(page).toHaveURL(/\/$/);
});
