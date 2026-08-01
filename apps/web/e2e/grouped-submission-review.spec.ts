import { expect, test } from '@playwright/test';

import { startMockApiServer, taskListResponse } from './mock-api';

let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

test.beforeAll(async () => {
  mockApi = await startMockApiServer();
});

test.afterAll(async () => {
  await mockApi?.close();
});

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name.includes('mobile'),
    'Edge-width grouped review is covered in critical-mobile.spec.ts.'
  );

  await page.route('**/trpc/**', async (route) => {
    const procedures = new URL(route.request().url()).pathname
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
});

test('groups a revision flood by submitter and preserves inline history', async ({ page }) => {
  await page.goto('/dashboard/tasks/e2e-grouped-submission-review');

  const comparison = page.getByRole('region', { name: /Artifact comparison/i });
  await expect(comparison.getByRole('group', { name: /1 submission/i })).toHaveCount(10);
  await expect(page.getByTestId('submission-review-summary')).toContainText(
    '12 active submitters · 161 active submissions'
  );
  await expect(page.getByText('Showing 1-10 of 12 submitters')).toBeVisible();
  await expect(
    page
      .getByTestId('submitter-group-0x4444444444444444444444444444444444444444')
      .getByRole('button', { name: /View submission/i })
  ).toHaveCount(0);

  await page.getByRole('button', { exact: true, name: 'Gallery' }).click();
  const outerGallery = page.getByRole('dialog');
  await expect(outerGallery).toContainText('1 / 1');
  await expect(outerGallery).toContainText(
    'second-worker-final-with-an-extremely-long-review-filename.png'
  );
  await expect(outerGallery).not.toContainText('first-spam-revision.png');
  await outerGallery.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(comparison.getByRole('group', { name: /150 submissions/i })).toHaveCount(1);
  await comparison.getByRole('button', { name: /^View all 150 submissions from/ }).click();

  await expect(page.getByRole('heading', { name: 'Submitter history' })).toBeFocused();
  await expect(page.getByText('Showing 1-10 of 150 submissions')).toBeVisible();
  await expect(page.getByText('Page 1 of 15')).toBeVisible();
  await expect(page.getByRole('region', { name: /^Submission \d+ of 150 from/ })).toHaveCount(10);

  await page.getByRole('button', { name: 'List view' }).click();
  await page.getByRole('combobox', { name: 'Sort submitter history' }).selectOption('oldest');
  await page.getByRole('button', { name: /Open first-spam-revision\.png preview/i }).click();
  const historyGallery = page.getByRole('dialog');
  await expect(historyGallery).toContainText('1 / 3');
  await expect(historyGallery).toContainText('first-spam-revision.png');
  await historyGallery.getByRole('button', { name: 'Next artifact' }).click();
  await expect(historyGallery).toContainText('first-spam-revision.mp4');
  await historyGallery.getByRole('button', { name: 'Next artifact' }).click();
  await expect(historyGallery).toContainText('first-spam-revision.html');
  await expect(
    historyGallery.getByText(/untrusted interactive html.*do not enter passwords/i)
  ).toBeVisible();
  await expect(
    historyGallery.getByTitle('Interactive preview of first-spam-revision.html')
  ).toHaveAttribute('sandbox', 'allow-scripts');
  await historyGallery.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Back to all submitters' }).click();
  await expect(page.getByRole('heading', { name: 'Submission review' })).toBeVisible();
  const rejected = page.getByTestId('rejected-submitters');
  await rejected.getByText('Rejected submitters (1)').click();
  await rejected.getByRole('button', { name: 'View history' }).click();
  await expect(page.getByRole('heading', { name: 'Submitter history' })).toBeVisible();
  await expect(page.getByText('Rejected').first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Submitter decisions' })).toHaveCount(0);
});
