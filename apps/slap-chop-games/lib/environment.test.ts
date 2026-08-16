import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment';

// Verifies: ADR-0087
describe('parseEnvironment', () => {
  it('provides safe local defaults without inventing an API origin', () => {
    const environment = parseEnvironment({});

    expect(environment).toMatchObject({
      DEPLOY_ENVIRONMENT: 'local',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3007',
      SLAP_CHOP_DATA_MODE: 'environment',
    });
    expect(environment).not.toHaveProperty('NEXT_PUBLIC_API_URL');
    expect(environment).not.toHaveProperty('TASKMARKET_API_URL');
  });

  it('rejects non-http service origins', () => {
    expect(() => parseEnvironment({ NEXT_PUBLIC_SITE_URL: 'ftp://games.taskmarket.dev' })).toThrow(
      'Invalid Slap-Chop Games environment'
    );
  });

  it('requires an explicit production source only for read-only live data mode', () => {
    expect(() => parseEnvironment({ SLAP_CHOP_DATA_MODE: 'live-readonly' })).toThrow(
      'SLAP_CHOP_LIVE_SOURCE_API_URL is required'
    );

    expect(
      parseEnvironment({
        SLAP_CHOP_DATA_MODE: 'live-readonly',
        SLAP_CHOP_LIVE_SOURCE_API_URL: 'https://api.taskmarket.dev/',
      })
    ).toMatchObject({
      SLAP_CHOP_DATA_MODE: 'live-readonly',
      SLAP_CHOP_LIVE_SOURCE_API_URL: 'https://api.taskmarket.dev',
    });
  });

  it('refuses the cross-environment source mode in production', () => {
    expect(() =>
      parseEnvironment({
        DEPLOY_ENVIRONMENT: 'production',
        SLAP_CHOP_DATA_MODE: 'live-readonly',
        SLAP_CHOP_LIVE_SOURCE_API_URL: 'https://api.taskmarket.dev',
      })
    ).toThrow('SLAP_CHOP_DATA_MODE cannot be live-readonly in production');
  });
});
