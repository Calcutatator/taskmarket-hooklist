import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const mockApiUrl = `http://127.0.0.1:${process.env.SLAP_CHOP_E2E_API_PORT ?? 3107}`;
const securitySinkUrl = `${mockApiUrl}/test/security-sink`;
const sandboxJailDataProbeReadyLog = 'taskmarket:sandbox-jail-data-probe-ready';
const sandboxJailDataNavigationLog = 'taskmarket:sandbox-jail-data-navigation-fired';
const sandboxJailDataDocumentReadyLog = 'taskmarket:sandbox-jail-data-document-ready';
const sandboxJailDataDocumentAttacksLog = 'taskmarket:sandbox-jail-data-document-attacks-fired';
const sandboxJailHttpProbeReadyLog = 'taskmarket:sandbox-jail-http-probe-ready';
const sandboxJailHttpNavigationLog = 'taskmarket:sandbox-jail-http-navigation-fired';

async function getSecuritySinkCount(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${securitySinkUrl}/count`);

  expect(response.ok()).toBe(true);
  return ((await response.json()) as { count: number }).count;
}

function collectProbeLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (message) => {
    logs.push(message.text());
  });
  return logs;
}

async function expectTrustedNestedJail(page: Page, gameTitle: string) {
  const outerFrame = page.getByTitle(`${gameTitle} game`);
  await expect(outerFrame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(outerFrame).toHaveAttribute('allow', '');
  await expect(outerFrame).toHaveAttribute('referrerpolicy', 'no-referrer');

  const outerSource = await outerFrame.getAttribute('srcdoc');
  expect(outerSource).toContain('frame-src data:');
  expect(outerSource).toContain('data-taskmarket-game');
  expect(outerSource).not.toContain(securitySinkUrl);

  const outerSelector = `iframe[title="${gameTitle} game"]`;
  const nestedFrame = page
    .frameLocator(outerSelector)
    .locator('iframe[data-taskmarket-game-frame]');
  await expect(nestedFrame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(nestedFrame).toHaveAttribute('allow', '');
  await expect(nestedFrame).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(nestedFrame).toHaveAttribute('src', /^data:text\/html;base64,/);

  return page.frameLocator(outerSelector).frameLocator('iframe[data-taskmarket-game-frame]');
}

// Verifies: ADR-0087. The game may enter a data document, but that document inherits the
// trusted wrapper policy. Its own image, fetch, and meta-refresh attempts must not reach a sink.
test('keeps egress blocked after the nested game self-navigates to a data document', async ({
  page,
  request,
}) => {
  const reset = await request.post(`${securitySinkUrl}/reset`);
  expect(reset.ok()).toBe(true);
  const probeLogs = collectProbeLogs(page);

  await page.goto('/games/sandbox-jail-data-probe');

  const nestedGame = await expectTrustedNestedJail(page, 'Sandbox Jail Data Probe');
  await expect(nestedGame.locator('#sandbox-jail-data-probe')).toHaveText(
    'Sandbox jail data probe'
  );
  await expect.poll(() => probeLogs.includes(sandboxJailDataProbeReadyLog)).toBe(true);
  await expect.poll(() => probeLogs.includes(sandboxJailDataNavigationLog)).toBe(true);
  await expect.poll(() => probeLogs.includes(sandboxJailDataDocumentReadyLog)).toBe(true);
  await expect.poll(() => probeLogs.includes(sandboxJailDataDocumentAttacksLog)).toBe(true);

  await page.waitForTimeout(500);
  await expect.poll(() => getSecuritySinkCount(request)).toBe(0);
  await expect(page).toHaveURL(/\/games\/sandbox-jail-data-probe$/);
});

// Verifies: ADR-0087. A direct HTTP self-navigation is rejected by the wrapper's data-only
// frame policy before a request can leave the nested game frame.
test('blocks direct HTTP self-navigation from the nested game', async ({ page, request }) => {
  const reset = await request.post(`${securitySinkUrl}/reset`);
  expect(reset.ok()).toBe(true);
  const probeLogs = collectProbeLogs(page);

  await page.goto('/games/sandbox-jail-http-probe');

  const nestedGame = await expectTrustedNestedJail(page, 'Sandbox Jail HTTP Probe');
  await expect(nestedGame.locator('#sandbox-jail-http-probe')).toHaveText(
    'Sandbox jail HTTP probe'
  );
  await expect.poll(() => probeLogs.includes(sandboxJailHttpProbeReadyLog)).toBe(true);
  await expect.poll(() => probeLogs.includes(sandboxJailHttpNavigationLog)).toBe(true);

  await page.waitForTimeout(500);
  await expect.poll(() => getSecuritySinkCount(request)).toBe(0);
  await expect(page).toHaveURL(/\/games\/sandbox-jail-http-probe$/);
});
