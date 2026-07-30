import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  isWebKitMediaControlIconLoadError,
  isWebKitRscPrefetchAccessControlError,
} from './client-errors';
import { startMockApiServer, taskListResponse } from './mock-api';

const clientFailures = new WeakMap<Page, string[]>();
let mockApi: Awaited<ReturnType<typeof startMockApiServer>>;

async function expectNoHorizontalOverflow(page: Page) {
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
}

// The desktop Dialog renders an explicit Close control; the mobile bottom Drawer
// (vaul) does not, so it is dismissed by Escape instead -- the same pattern already
// used to close the mobile filter drawer (see critical-mobile.spec.ts). Escape only
// reaches the outer Dialog/Drawer primitive's own listener if DOM focus is inside its
// document: a native keydown fired while focus sits inside the artifact's sandboxed
// srcDoc iframe never bubbles out to the parent document, so focus is moved back onto
// a plain element in the dialog chrome first.
async function closeArtifactDialog(page: Page, dialog: Locator) {
  const closeButton = dialog.getByRole('button', { name: /Close/i });
  if (await closeButton.count()) {
    await closeButton.click();
    return;
  }

  await dialog.getByText(/^\d+ \/ \d+$/).click();
  await page.keyboard.press('Escape');
}

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

test.beforeEach(async ({ page }, testInfo) => {
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
      if (text.includes('preview-network-block.test') && text.includes('Content Security Policy')) {
        return;
      }
      if (isWebKitRscPrefetchAccessControlError(testInfo.project.name, text)) {
        // WebKit can report speculative Next.js RSC prefetches as access-control
        // console errors even though the requested navigation succeeds.
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

test.afterEach(async ({ page }) => {
  expect(clientFailures.get(page) ?? []).toEqual([]);
});

const publicRoutes = [
  { heading: /Fund one task\. Unleash a market of agents\./i, path: '/' },
  { heading: /A custom infographic for \$1\./i, path: '/try' },
  { heading: /Open tasks/i, path: '/tasks' },
  { heading: /^Agents$/i, path: '/agents' },
  { heading: /^Humans$/i, path: '/humans' },
  { heading: /Leaderboard/i, path: '/leaderboard' },
  { heading: /Task Market Protocol/i, path: '/protocol' },
  { heading: /Open tasks/i, path: '/dashboard/tasks' },
  { heading: /^Task Drops$/i, path: '/dashboard/drops' },
  { heading: /Agent directory/i, path: '/dashboard/agents' },
  { heading: /Humans directory/i, path: '/dashboard/humans' },
  { heading: /Leaderboard/i, path: '/dashboard/leaderboard' },
  { heading: /Task Market Protocol/i, path: '/dashboard/protocol' },
  { heading: /^Agent setup$/i, path: '/dashboard/for-agents' },
  { heading: /Marketplace overview/i, path: '/dashboard' },
];

for (const route of publicRoutes) {
  test(`renders ${route.path} without client errors or horizontal overflow`, async ({ page }) => {
    await page.goto(route.path);

    await expect(
      page.getByRole('heading', { name: route.heading }).filter({ visible: true }).first()
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error/);

    await expectNoHorizontalOverflow(page);
  });
}

test('keeps Task Drops in primary navigation and presents the directory as cards', async ({
  page,
}, testInfo) => {
  await page.goto('/dashboard/drops');

  if (testInfo.project.name.includes('mobile')) {
    await page.getByRole('button', { name: /Toggle Sidebar/i }).click();
  }

  await expect(
    page.locator('[data-sidebar="menu"] a[href="/dashboard/drops"]').filter({
      hasText: /^Task Drops$/,
    })
  ).toBeVisible();
  if (testInfo.project.name.includes('mobile')) {
    await page.keyboard.press('Escape');
  }

  await expect(
    page.getByRole('region', { name: /Current official drop/i }).getByRole('article')
  ).toHaveCount(1);
  await expect(
    page.getByRole('region', { name: /Browse Task Drops/i }).getByRole('article')
  ).toHaveCount(1);
});

test('shows weekly active agents alongside registered agents on the dashboard', async ({
  page,
}) => {
  await page.goto('/dashboard');

  const metrics = page.getByRole('region', { name: /Marketplace metrics/i });
  const activeAgentsLabel = metrics.getByText('Weekly active agents', { exact: true });

  await expect(activeAgentsLabel).toBeVisible();
  await expect(activeAgentsLabel.locator('..').locator('dd')).toHaveText('4');
  await expect(metrics.getByText('Registered agents', { exact: true })).toBeVisible();
});

test('keeps dashboard header actions aligned as one control group', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'The full action group is desktop-only.');

  await page.goto('/dashboard');

  const actionGroup = page.getByRole('group', { name: /Dashboard actions/i });
  const controls = actionGroup.locator(
    ':scope > [data-slot="button"], :scope > [data-slot="dropdown-menu-trigger"], :scope > [data-slot="skill-install-snippet"]'
  );
  await expect(controls).toHaveCount(4);

  const dimensions = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const styles = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        paddingLeft: Number.parseFloat(styles.paddingLeft),
        paddingRight: Number.parseFloat(styles.paddingRight),
      };
    })
  );

  expect(new Set(dimensions.map(({ height }) => height))).toEqual(new Set([36]));
  expect(new Set(dimensions.map(({ paddingLeft }) => paddingLeft))).toEqual(new Set([14]));
  expect(new Set(dimensions.map(({ paddingRight }) => paddingRight))).toEqual(new Set([14]));
});

test('opens the dashboard marketplace from the landing page primary navigation', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Primary landing nav is hidden on mobile.');

  await page.goto('/');

  await page
    .getByRole('navigation', { name: /^Primary$/i })
    .getByRole('link', { name: /^Tasks$/i })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/tasks$/);
  await expect(page.getByRole('region', { name: /Task list/i })).toBeVisible();
});

test('keeps the public navigation chrome vertically aligned', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Primary landing nav is hidden on mobile.');

  await page.goto('/');

  const header = page.getByRole('banner');
  const controls = [
    header.getByRole('button', { name: /^Sign in(?: unavailable)?$/i }),
    header.getByRole('link', { name: /^Latest Drop$/i }),
    header.getByRole('link', { name: /^Dashboard$/i }),
  ];
  const logo = header.getByRole('link', { name: /^Taskmarket home$/i }).locator('> span');
  const primaryNav = header.getByRole('navigation', { name: /^Primary$/i });

  const controlBoxes = await Promise.all(controls.map((control) => control.boundingBox()));
  expect(new Set(controlBoxes.map((box) => box?.height))).toEqual(new Set([36]));

  const chromeBoxes = await Promise.all([
    logo.boundingBox(),
    primaryNav.boundingBox(),
    ...controls.map((control) => control.boundingBox()),
  ]);
  const centerYs = chromeBoxes.map((box) => (box?.y ?? 0) + (box?.height ?? 0) / 2);
  expect(Math.max(...centerYs) - Math.min(...centerYs)).toBeLessThanOrEqual(0.5);
});

test('keeps the top-level market routes public instead of redirecting them', async ({ page }) => {
  await page.goto('/tasks?status=open');
  await expect(page).toHaveURL(/\/tasks\?status=open$/);
  await expect(
    page.getByRole('region', { name: /Task list/i }).getByRole('heading', { name: /Open tasks/i })
  ).toBeVisible();
  await page.waitForLoadState('networkidle');

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
  const taskSidebar = page.getByRole('complementary', { name: /Task sidebar/i });
  await expect(taskSidebar.getByRole('heading', { name: /Review status/i })).toBeVisible();
  await expect(taskSidebar.getByText(/Only requester .* can release escrow/i)).toBeVisible();

  await comparison.getByRole('button', { name: /Open candidate-a\.png preview/i }).click();
  const previewImage = page.getByRole('dialog').getByRole('img', { name: 'candidate-a.png' });
  const portraitPreviewUrl =
    'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22800%22/%3E';
  const previewLayout = await previewImage.evaluate(async (image, src) => {
    const imageElement = image as HTMLImageElement;
    imageElement.src = src;
    await imageElement.decode();

    const frame = imageElement.parentElement;
    return {
      fitsFrame: Boolean(
        frame &&
        imageElement.clientHeight <= frame.clientHeight &&
        imageElement.clientWidth <= frame.clientWidth
      ),
      isPortrait: imageElement.naturalHeight > imageElement.naturalWidth,
      objectFit: getComputedStyle(imageElement).objectFit,
    };
  }, portraitPreviewUrl);
  expect(previewLayout).toEqual({ fitsFrame: true, isPortrait: true, objectFit: 'contain' });

  await expectNoHorizontalOverflow(page);
});

test('runs submitted HTML inline while isolating it from the platform and network', async ({
  page,
}) => {
  let blockedNetworkRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'preview-network-block.test') {
      blockedNetworkRequests += 1;
    }
  });

  await page.goto('/dashboard/tasks/e2e-pending-review');

  // Interactive HTML is now a first-class playable artifact: it surfaces as a media
  // thumbnail in the gallery layout (the review queue's default view) rather than
  // being buried in the "Supporting files" disclosure, and opens through the shared
  // submission gallery (a centered Dialog at md+, a bottom Drawer below md).
  const comparison = page.getByRole('region', { name: /Artifact comparison/i });
  await comparison
    .getByRole('button', { name: /Open candidate-a-calculator\.html preview/i })
    .click();

  const dialog = page.getByRole('dialog');
  const frameTitle = 'Interactive preview of candidate-a-calculator.html';
  // The gallery windows up to 3 adjacent panes (prev/current/next) at once, but only
  // one entry in this fixture is the HTML artifact, so exactly one iframe with this
  // title can ever be mounted regardless of how many panes are in the window.
  await expect(page.locator(`iframe[title="${frameTitle}"]`)).toHaveCount(1);

  const frameElement = dialog.getByTitle(frameTitle);
  await expect(frameElement).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frameElement).toHaveAttribute('allow', '');
  await expect(frameElement).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(dialog.getByRole('link', { name: /Open artifact/i })).toHaveCount(0);

  const frame = page.frameLocator(`iframe[title="${frameTitle}"]`);
  await expect(frame.getByRole('heading', { name: 'Submission calculator' })).toBeVisible();
  await expect(frame.getByText('Parent access blocked')).toBeVisible();
  await expect(frame.getByText('Network access blocked')).toBeVisible();
  await frame.getByLabel('First number').fill('7');
  await frame.getByLabel('Second number').fill('8');
  await frame.getByRole('button', { name: 'Add numbers' }).click();
  await expect(frame.getByRole('status')).toHaveText('15');
  expect(blockedNetworkRequests).toBe(0);

  await closeArtifactDialog(page, dialog);
  await expect(frameElement).toHaveCount(0);
});

test('offers dedicated HTML showcase tasks with distinct interactive submissions', async ({
  page,
}) => {
  const showcases = [
    {
      actionLabel: 'Team',
      changedText: 'Make decisions together.',
      fileName: 'northline-launch.html',
      heading: 'Make room for the work that matters.',
      taskId: 'mock-html-landing-page',
    },
    {
      actionLabel: 'Week',
      changedText: 'Rolling view for this week',
      fileName: 'harbor-operations.html',
      heading: 'Today at a glance',
      taskId: 'mock-html-dashboard',
    },
    {
      actionLabel: 'Research pair',
      changedText: 'The pair can split interviews and compare notes during synthesis.',
      fileName: 'fieldnote-estimator.html',
      heading: 'Plan a focused research sprint',
      taskId: 'mock-html-estimator',
    },
  ];

  for (const showcase of showcases) {
    await page.goto(`/dashboard/tasks/${showcase.taskId}`);

    const comparison = page.getByRole('region', { name: /Artifact comparison/i });
    const frameTitle = `Interactive preview of ${showcase.fileName}`;
    const previewButton = comparison.getByRole('button', {
      name: new RegExp(`Open ${showcase.fileName} preview`, 'i'),
    });
    await expect(previewButton.locator(`iframe[title="${frameTitle}"]`)).toHaveCount(1);
    await previewButton.click();

    const dialog = page.getByRole('dialog');
    const frameElement = dialog.getByTitle(frameTitle);
    await expect(frameElement).toHaveAttribute('sandbox', 'allow-scripts');

    const frame = dialog.frameLocator(`iframe[title="${frameTitle}"]`);
    await expect(frame.getByRole('heading', { name: showcase.heading })).toBeVisible();
    await expect(frame.locator('html')).toHaveAttribute('data-ready', 'true');
    await expect(async () => {
      await frame.getByRole('button', { name: showcase.actionLabel }).click();
      await expect(frame.getByText(showcase.changedText)).toBeVisible();
    }).toPass({ timeout: 15_000 });
    expect(
      await frame.locator('html').evaluate((element) => element.scrollWidth > element.clientWidth)
    ).toBe(false);

    await closeArtifactDialog(page, dialog);
    await expect(frameElement).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  }
});

test('surfaces the live status banner on an open task and stays hydration-clean', async ({
  page,
}) => {
  await page.goto('/dashboard/tasks/mock-bounty-open');

  const banner = page.getByRole('status', { name: /Task status/i });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Live and broadcasting to the network/i);

  await expectNoHorizontalOverflow(page);
});

test('guides task visitors into human or agent participation', async ({ page }) => {
  await page.goto('/tasks/mock-bounty-open');

  const participation = page.getByTestId('task-participation');
  await expect(participation.getByRole('heading', { name: /Want to take this on/i })).toBeVisible();
  await expect(participation.getByRole('button', { name: /Sign in unavailable/i })).toBeDisabled();
  await expect(
    participation.getByRole('button', { name: /Connect wallet to upload/i })
  ).toHaveCount(0);
  await expect(participation.getByRole('button', { name: /^Upload files$/i })).toHaveCount(0);
  await expect(participation.getByRole('link', { name: /How this works/i })).toHaveAttribute(
    'href',
    '/dashboard/task-types'
  );

  const setupLink = participation.getByRole('link', { name: /Set up an agent/i });
  await expect(setupLink).toHaveAttribute(
    'href',
    '/dashboard/for-agents?source=task-detail&taskId=mock-bounty-open'
  );

  const developerDetails = participation.getByRole('group', { name: /For developers/i });
  await expect(developerDetails).not.toHaveAttribute('open');
  await developerDetails.getByText(/For developers/i).click();
  await expect(developerDetails).toHaveAttribute('open');
  await expect(
    developerDetails.getByText('taskmarket task submit mock-bounty-open --file <path>')
  ).toBeVisible();
  await expect(developerDetails.getByText('taskmarket task list --status open')).toBeVisible();

  const emptySubmissions = page.getByText(/Submissions will appear here/i);
  await expect(emptySubmissions).toBeVisible();
  const moduleComesFirst = await participation.evaluate(
    (module, emptyState) =>
      Boolean(
        module.compareDocumentPosition(emptyState as Node) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
    await emptySubmissions.elementHandle()
  );
  expect(moduleComesFirst).toBe(true);

  await expectNoHorizontalOverflow(page);
});

test('keeps long task brief references within the mobile viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile task-detail regression.');

  await page.goto('/tasks/mock-bounty-open');

  await expect(page.getByRole('heading', { name: /Details/i })).toBeVisible();
  await expect(
    page.locator('#main-content').getByText(/7ba0f258954455441a7bd3d21ca19049/i)
  ).toBeVisible();

  await expectNoHorizontalOverflow(page);
});

test('hides the live status banner on a terminal task', async ({ page }) => {
  await page.goto('/dashboard/tasks/mock-cancelled');

  await expect(page.getByRole('status', { name: /Task status/i })).toHaveCount(0);
});

test('shows the Unlisted badge and stays reachable by direct link (ADR-0014)', async ({ page }) => {
  await page.goto('/tasks/mock-bounty-unlisted');

  await expect(page.getByRole('heading', { name: /Bounty - unlisted task/i })).toBeVisible();
  await expect(page.getByText('Unlisted', { exact: true })).toBeVisible();

  await expectNoHorizontalOverflow(page);
});

test('renders every split settlement recipient and canonical payout amount', async ({ page }) => {
  await page.goto('/dashboard/tasks/mock-bounty-split-settlement');

  const payouts = page.getByRole('region', { name: /Settlement payouts/i });
  await expect(payouts).toBeVisible();
  await expect(payouts.getByText('3 winners')).toBeVisible();
  await expect(payouts.getByText('2 USDC', { exact: true })).toBeVisible();
  await expect(payouts.getByText('1.9 USDC', { exact: true })).toBeVisible();
  await expect(payouts.getByText('0.1 USDC', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 3 rated').first()).toBeVisible();

  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
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

  await expectNoHorizontalOverflow(page);
});

test('prioritizes mobile task results and moves filters into a drawer', async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only task browse layout.');

  await page.goto(
    '/dashboard/tasks?taskDropId=launch-drop&cursor=2026-07-21T00%3A00%3A00.000Z&cursorStack=2026-07-22T00%3A00%3A00.000Z'
  );

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
  const filterDialog = page.getByRole('dialog', { name: /Task filters/i });
  await expect(filterDialog).toBeVisible();

  const taskDropInput = filterDialog.getByLabel(/Task Drop ID/i);
  await expect(taskDropInput).toHaveValue('launch-drop');
  await expect(filterDialog.getByRole('link', { name: /^auction$/i })).toHaveAttribute(
    'href',
    '/dashboard/tasks?mode=auction&taskDropId=launch-drop'
  );
  await filterDialog.getByRole('button', { name: /Apply filters/i }).click();
  await expect
    .poll(() => {
      const currentUrl = new URL(page.url());
      return {
        cursor: currentUrl.searchParams.get('cursor'),
        cursorStack: currentUrl.searchParams.get('cursorStack'),
        pathname: currentUrl.pathname,
        taskDropId: currentUrl.searchParams.get('taskDropId'),
      };
    })
    .toEqual({
      cursor: null,
      cursorStack: null,
      pathname: '/dashboard/tasks',
      taskDropId: 'launch-drop',
    });
  const taskList = page.getByRole('list', { name: /Task (cards|gallery)/i });
  await expect(taskList.getByText(/Bounty - open submission pool/i)).toBeVisible();
  await expect(taskList.getByText(/Claim - first worker reserves/i)).toHaveCount(0);

  await expectNoHorizontalOverflow(page);
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

test('runs the /try prompt-to-brief path with loaded proof images and keyboard order', async ({
  page,
}, testInfo) => {
  await page.goto('/try', { waitUntil: 'networkidle' });

  const heroHeading = page.getByRole('heading', { name: /A custom infographic for \$1\./i });
  const topic = page.getByLabel('What should yours explain?', { exact: true }).first();
  const buildButton = page.getByRole('button', { name: /Build my brief/i }).first();
  await expect(heroHeading).toBeVisible();
  await expect(topic).toBeVisible();
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: /Skip to content/i });
  if (
    testInfo.project.name.includes('webkit') &&
    !(await skipLink.evaluate((node) => node.matches(':focus')))
  ) {
    // Mobile Safari does not include links in sequential keyboard focus unless
    // Full Keyboard Access is enabled, but the skip link must remain directly focusable.
    await skipLink.focus();
  }
  await expect(skipLink).toBeFocused();
  const builderTop = await page
    .locator('#try-builder')
    .evaluate((node) => Math.round(node.getBoundingClientRect().top));
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(viewportHeight - builderTop).toBeGreaterThanOrEqual(48);

  await topic.focus();
  await page.keyboard.press('Tab');
  if (
    testInfo.project.name.includes('webkit') &&
    !(await buildButton.evaluate((node) => node.matches(':focus')))
  ) {
    // The same Mobile Safari setting can omit form controls from sequential focus.
    await buildButton.focus();
  }
  await expect(buildButton).toBeFocused();

  await topic.fill('Why battery storage keeps getting cheaper');
  await buildButton.click();

  await expect(page.getByLabel(/Infographic topic/i)).toHaveValue(
    'Why battery storage keeps getting cheaper'
  );
  await expect(page.getByLabel(/Target audience/i)).toBeFocused();

  const gallery = page.getByRole('heading', {
    name: /Real briefs\. Real agents\. Finished infographics\./i,
  });
  await gallery.scrollIntoViewIfNeeded();
  const proofImages = page.locator('article img[alt]');
  await expect(proofImages).toHaveCount(6);
  for (const image of await proofImages.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect(page.locator('.try-drop-collage')).toHaveAttribute('data-running', 'false');

  await expectNoHorizontalOverflow(page);
});

test('explains when /try publication is unavailable without Privy', async ({ page }) => {
  test.skip(
    Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
    'This fallback is only rendered when Privy is not configured.'
  );

  await page.goto('/try', { waitUntil: 'networkidle' });
  const prompt = page.getByLabel('What should yours explain?', { exact: true }).first();
  const topic = 'How heat pumps move more energy than they consume';
  await prompt.fill(topic);
  await expect(prompt).toHaveValue(topic);
  await page
    .getByRole('button', { name: /Build my brief/i })
    .first()
    .click();
  await expect(page.getByLabel(/Infographic topic/i)).toHaveValue(topic);
  await page.getByLabel(/Target audience/i).fill('Homeowners comparing heating systems');
  await page.getByRole('button', { name: /Review and fund/i }).click();

  await expect(page.getByRole('heading', { name: /Fund and publish/i })).toBeVisible();
  await expect(page.getByText('Publication is unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publishing unavailable' })).toBeDisabled();
});

test('keeps /try static and legible with reduced motion and long input', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/try');

  const collageAnimation = await page
    .locator('.try-drop-strip')
    .first()
    .evaluate((node) => getComputedStyle(node).animationName);
  expect(collageAnimation).toBe('none');
  const duplicateDisplay = await page
    .locator('.try-drop-track-group[data-duplicate="true"]')
    .first()
    .evaluate((node) => getComputedStyle(node).display);
  expect(duplicateDisplay).toBe('none');

  const topic = page.getByLabel('What should yours explain?', { exact: true }).first();
  await topic.fill('A'.repeat(180));
  await expect(topic).toHaveValue('A'.repeat(180));

  await expectNoHorizontalOverflow(page);
});

test('captures /try at the campaign regression viewports', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Captured once from the desktop project.');

  const viewports = [
    { height: 844, label: '390x844', width: 390 },
    { height: 1024, label: '768x1024', width: 768 },
    { height: 900, label: '1440x900', width: 1440 },
    { height: 1000, label: '1728x1000', width: 1728 },
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await page.goto('/try');
    await expect(
      page.getByRole('heading', { name: /A custom infographic for \$1\./i })
    ).toBeVisible();
    await testInfo.attach(`try-${viewport.label}`, {
      body: await page.screenshot({ animations: 'disabled', fullPage: true }),
      contentType: 'image/png',
    });
  }

  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/try');
  await testInfo.attach('try-390x844-reduced-motion', {
    body: await page.screenshot({ animations: 'disabled', fullPage: true }),
    contentType: 'image/png',
  });

  await page.setViewportSize({ height: 1000, width: 1728 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/try');
  await page
    .getByLabel('What should yours explain?', { exact: true })
    .first()
    .fill('A detailed comparison of grid-scale batteries across cost, lifespan, and safety');
  await testInfo.attach('try-1728x1000-long-input', {
    body: await page.screenshot({ animations: 'disabled', fullPage: true }),
    contentType: 'image/png',
  });
});
