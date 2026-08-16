import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment';

// Verifies: ADR-0087
describe('parseEnvironment', () => {
  it('provides safe local defaults without inventing an API origin', () => {
    const environment = parseEnvironment({});

    expect(environment).toMatchObject({
      DEPLOY_ENVIRONMENT: 'local',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3007',
    });
    expect(environment).not.toHaveProperty('NEXT_PUBLIC_API_URL');
    expect(environment).not.toHaveProperty('TASKMARKET_API_URL');
  });

  it('rejects non-http service origins', () => {
    expect(() => parseEnvironment({ NEXT_PUBLIC_SITE_URL: 'ftp://games.taskmarket.dev' })).toThrow(
      'Invalid Slap-Chop Games environment'
    );
  });
});
