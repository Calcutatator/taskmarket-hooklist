import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.PORT ?? 3001);
const mockApiPort = Number(process.env.E2E_MOCK_API_PORT ?? 3101);
const baseURL = `http://127.0.0.1:${webPort}`;
const mockApiUrl = `http://127.0.0.1:${mockApiPort}`;
const healthURL = `${baseURL}/protocol`;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: 'test-results',
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
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
