// Verifies: ADR-0087
import { describe, expect, it, vi } from 'vitest';

const { logSlapChopArtifactDeliveryFailure, slapChopDurationMs } = vi.hoisted(() => ({
  logSlapChopArtifactDeliveryFailure: vi.fn(),
  slapChopDurationMs: vi.fn().mockReturnValue(12),
}));

vi.mock('../../../src/lib/slap-chop-observability', () => ({
  logSlapChopArtifactDeliveryFailure,
  slapChopDurationMs,
}));

import {
  GAME_DELIVERY_URL_TTL_SECONDS,
  getGameDeliveryUrl,
} from '../../../src/services/game-delivery';

describe('Slap-Chop game delivery', () => {
  it('mints a short-lived URL without returning the storage URI', async () => {
    const storage = {
      getPresignedUrl: vi.fn().mockResolvedValue('https://storage.example.test/signed-object'),
    };
    const now = new Date('2026-08-16T00:00:00.000Z');

    await expect(
      getGameDeliveryUrl('s3://private-bucket/slap-chop-games/cover.png', { now, storage })
    ).resolves.toEqual({
      url: 'https://storage.example.test/signed-object',
      expiresAt: new Date(now.getTime() + GAME_DELIVERY_URL_TTL_SECONDS * 1_000).toISOString(),
    });
    expect(storage.getPresignedUrl).toHaveBeenCalledWith(
      's3://private-bucket/slap-chop-games/cover.png',
      GAME_DELIVERY_URL_TTL_SECONDS
    );
  });

  it('returns null for a missing or unavailable object', async () => {
    const storage = { getPresignedUrl: vi.fn().mockRejectedValue(new Error('Object not found')) };

    await expect(getGameDeliveryUrl(null, { storage })).resolves.toBeNull();
    await expect(
      getGameDeliveryUrl('s3://private-bucket/missing', {
        operation: 'catalog_artifact',
        storage,
      })
    ).resolves.toBeNull();
    expect(logSlapChopArtifactDeliveryFailure).toHaveBeenCalledWith({
      durationMs: 12,
      operation: 'catalog_artifact',
      reason: 'presign_failed',
    });
  });
});
