import { defineConfig, devices } from '@playwright/test';

const appPort = Number(process.env.SLAP_CHOP_E2E_APP_PORT ?? 3007);
const mockApiPort = Number(process.env.SLAP_CHOP_E2E_API_PORT ?? 3107);
const baseURL = `http://127.0.0.1:${appPort}`;
const mockApiUrl = `http://127.0.0.1:${mockApiPort}`;

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  outputDir: 'test-results',
  projects: [
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { height: 900, width: 1440 },
      },
    },
    {
      name: 'mobile-chromium',
      use: devices['Pixel 5'],
    },
  ],
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  retries: process.env.CI ? 1 : 0,
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/mock-api.mjs',
      env: {
        SLAP_CHOP_E2E_API_PORT: String(mockApiPort),
      },
      reuseExistingServer: false,
      timeout: 30_000,
      url: `${mockApiUrl}/health`,
    },
    {
      // Exercise the same client bootstrap used in deployment. Turbopack's development HMR socket
      // is intentionally unavailable behind Playwright's isolated web-server proxy and can leave
      // a server-rendered route unhydrated without testing the player runtime.
      command: 'pnpm build && pnpm start',
      env: {
        NEXT_PUBLIC_API_URL: mockApiUrl,
        // The player route is intentionally anonymous. Keep a root development .env from
        // booting Privy here; configured identity flows have their own mocked coverage.
        NEXT_PUBLIC_PRIVY_APP_ID: '',
        NEXT_PUBLIC_PRIVY_CLIENT_ID: '',
        PORT: String(appPort),
        TASKMARKET_API_URL: mockApiUrl,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${baseURL}/api/health`,
    },
  ],
  workers: 1,
});
