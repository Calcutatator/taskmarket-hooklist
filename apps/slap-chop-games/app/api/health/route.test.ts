import { describe, expect, it } from 'vitest';

import { GET } from './route';

// Verifies: ADR-0087
describe('GET /api/health', () => {
  it('returns an uncached service identity for platform health checks', async () => {
    const response = await GET();

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      service: 'slap-chop-games',
      status: 'ok',
    });
  });
});
