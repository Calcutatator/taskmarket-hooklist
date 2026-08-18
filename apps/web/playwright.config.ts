import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.TASKMARKET_MOCK_WEB_PORT ?? 3001);
const mockApiPort = Number(
  process.env.E2E_MOCK_API_PORT ?? process.env.TASKMARKET_MOCK_API_PORT ?? 3101
);
const baseURL = `http://localhost:${webPort}`;
const mockApiUrl = `http://127.0.0.1:${mockApiPort}`;
const healthURL = `${baseURL}/dashboard/protocol`;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  // CI shards must split large spec files at test granularity. There is still only one worker
  // per shard, so tests inside a runner remain serial while independent runners share the load.
  fullyParallel: true,
  outputDir: 'test-results',
  projects: [
    {
      name: 'chromium-desktop',
      // --no-sandbox: lets Chromium launch without the SYS_ADMIN capability grant a
      // sandboxed launch would need in a container job; safe since these tests only ever
      // load this app's own pages, never untrusted content. WebKit projects below don't
      // need or accept this flag.
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--no-sandbox'] } },
    },
    {
      name: 'chromium-mobile-320',
      testMatch: '**/critical-mobile.spec.ts',
      use: {
        ...devices['Pixel 7'],
        viewport: { height: 844, width: 320 },
        launchOptions: { args: ['--no-sandbox'] },
      },
    },
    {
      name: 'chromium-mobile-390',
      use: {
        ...devices['Pixel 7'],
        viewport: { height: 844, width: 390 },
        launchOptions: { args: ['--no-sandbox'] },
      },
    },
    {
      name: 'chromium-mobile-430',
      testMatch: '**/critical-mobile.spec.ts',
      use: {
        ...devices['Pixel 7'],
        viewport: { height: 844, width: 430 },
        launchOptions: { args: ['--no-sandbox'] },
      },
    },
    {
      name: 'webkit-mobile-320',
      testMatch: '**/critical-mobile.spec.ts',
      use: {
        ...devices['iPhone 13'],
        viewport: { height: 844, width: 320 },
      },
    },
    {
      name: 'webkit-mobile-390',
      use: {
        ...devices['iPhone 13'],
        viewport: { height: 844, width: 390 },
      },
    },
    {
      name: 'webkit-mobile-430',
      testMatch: '**/critical-mobile.spec.ts',
      use: {
        ...devices['iPhone 13'],
        viewport: { height: 844, width: 430 },
      },
    },
  ],
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  retries: process.env.CI ? 2 : 0,
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm start',
    env: {
      E2E_MOCK_API_PORT: String(mockApiPort),
      NEXT_PUBLIC_API_URL: mockApiUrl,
      PORT: String(webPort),
      TASKMARKET_API_URL: mockApiUrl,
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: healthURL,
  },
  workers: 1,
});
