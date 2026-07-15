import { afterEach, describe, expect, it, vi } from 'vitest';

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

    const { default: config } = await import('./playwright.config');

    expect(config.use?.baseURL).toBe('http://localhost:3001');
    expect(config.webServer).toMatchObject({
      env: expect.objectContaining({ PORT: '3001' }),
      url: 'http://localhost:3001/dashboard/protocol',
    });
  });

  it('uses the shared mock API port when no e2e-specific port is configured', async () => {
    vi.stubEnv('TASKMARKET_MOCK_API_PORT', '3401');

    const { default: config } = await import('./playwright.config');

    expect(config.webServer).toMatchObject({
      env: expect.objectContaining({
        E2E_MOCK_API_PORT: '3401',
        NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3401',
      }),
    });
  });
});
