import { describe, expect, it } from 'vitest';

import { isWebKitLegalDiscoveryAccessControlError } from '../e2e/client-errors';

describe('WebKit client error filters', () => {
  it('matches only WebKit legal-discovery cancellations', () => {
    const message = '/localhost:3002/api/legal/current due to access control checks.';

    expect(isWebKitLegalDiscoveryAccessControlError('webkit-mobile-390', message)).toBe(true);
    expect(isWebKitLegalDiscoveryAccessControlError('chromium-mobile-390', message)).toBe(false);
    expect(
      isWebKitLegalDiscoveryAccessControlError(
        'webkit-mobile-390',
        '/localhost:3002/api/tasks due to access control checks.'
      )
    ).toBe(false);
  });
});
