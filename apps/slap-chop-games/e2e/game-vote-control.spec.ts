import { expect, test } from '@playwright/test';

// Verifies: ADR-0089. Anonymous catalog and player routes remain fully usable when the optional
// Privy configuration is absent; disabled vote controls do not gate play behind identity.
test('keeps anonymous browse and play available without loading identity', async ({ page }) => {
  await page.goto('/');

  const gameLink = page.getByRole('link', { name: 'Play Silent Orbit, score +59' });
  const catalogVote = page.getByRole('button', { name: 'Upvote Silent Orbit' });

  await expect(gameLink).toBeVisible();
  await expect(catalogVote).toBeDisabled();

  await gameLink.click();

  await expect(page).toHaveURL(/\/games\/silent-orbit$/);
  await expect(page.getByTitle('Silent Orbit game')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upvote Silent Orbit' })).toBeDisabled();
});
