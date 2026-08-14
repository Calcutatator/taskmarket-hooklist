import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@playwright/test', () => ({
  defineConfig: (config: unknown) => config,
  devices: {
    'Desktop Chrome': { userAgent: 'desktop-chrome' },
    'iPhone 13': { hasTouch: true, isMobile: true, userAgent: 'mobile-webkit' },
    'Pixel 7': { hasTouch: true, isMobile: true, userAgent: 'mobile-chromium' },
  },
}));

describe('Playwright configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses the mock web port instead of the backend port when both are configured', async () => {
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('TASKMARKET_MOCK_WEB_PORT', '3301');

    const { default: config } = await import('./playwright.config');

    expect(config.use?.baseURL).toBe('http://localhost:3301');
    expect(config.webServer).toMatchObject({
      env: expect.objectContaining({ PORT: '3301' }),
      url: 'http://localhost:3301/dashboard/protocol',
    });
  });

  it('does not treat the generic application port as the mock web port', async () => {
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('TASKMARKET_MOCK_WEB_PORT', undefined);

    const { default: config } = await import('./playwright.config');

    expect(config.use?.baseURL).toBe('http://localhost:3001');
    expect(config.webServer).toMatchObject({
      env: expect.objectContaining({ PORT: '3001' }),
      url: 'http://localhost:3001/dashboard/protocol',
    });
  });

  it('uses the shared mock API port when no e2e-specific port is configured', async () => {
    vi.stubEnv('E2E_MOCK_API_PORT', undefined);
    vi.stubEnv('TASKMARKET_MOCK_API_PORT', '3401');

    const { default: config } = await import('./playwright.config');

    expect(config.webServer).toMatchObject({
      env: expect.objectContaining({
        E2E_MOCK_API_PORT: '3401',
        NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3401',
      }),
    });
  });

  it('covers the exact critical mobile widths in Chromium and WebKit', async () => {
    const { default: config } = await import('./playwright.config');

    const projects = config.projects ?? [];
    expect(projects.map((project) => project.name)).toEqual([
      'chromium-desktop',
      'chromium-mobile-320',
      'chromium-mobile-390',
      'chromium-mobile-430',
      'webkit-mobile-320',
      'webkit-mobile-390',
      'webkit-mobile-430',
    ]);

    for (const engine of ['chromium', 'webkit']) {
      for (const width of [320, 390, 430]) {
        const project = projects.find(({ name }) => name === `${engine}-mobile-${width}`);
        expect(project?.use).toMatchObject({
          hasTouch: true,
          isMobile: true,
          userAgent: `mobile-${engine}`,
          viewport: { height: 844, width },
        });
      }
    }
  });

  it('runs the full suite at 390px and only critical coverage at edge widths', async () => {
    const { default: config } = await import('./playwright.config');
    const projects = config.projects ?? [];

    for (const name of ['chromium-mobile-390', 'webkit-mobile-390', 'chromium-desktop']) {
      expect(projects.find((project) => project.name === name)?.testMatch).toBeUndefined();
    }
    for (const engine of ['chromium', 'webkit']) {
      for (const width of [320, 430]) {
        expect(projects.find(({ name }) => name === `${engine}-mobile-${width}`)?.testMatch).toBe(
          '**/critical-mobile.spec.ts'
        );
      }
    }
  });

  it('allows CI shards to balance individual tests while keeping one worker per shard', async () => {
    const { default: config } = await import('./playwright.config');

    expect(config.fullyParallel).toBe(true);
    expect(config.workers).toBe(1);
  });
});
