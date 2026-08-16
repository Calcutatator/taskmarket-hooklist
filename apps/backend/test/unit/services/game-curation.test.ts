// Verifies: ADR-0087 and ADR-0088
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  GameCurationError,
  catalogCoverStorageKey,
  validateGameCoverBytes,
} from '../../../src/services/game-curation';

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe('Slap-Chop game cover verification', () => {
  it('pins a verified square image under a content-addressed catalog key', () => {
    const cover = validateGameCoverBytes(png(64, 64), 'image/png');

    expect(cover).toMatchObject({ height: 64, mimeType: 'image/png', width: 64 });
    expect(cover.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
    expect(catalogCoverStorageKey(cover.sha256Hash, cover.mimeType)).toBe(
      `slap-chop-games/covers/sha256/${cover.sha256Hash}.png`
    );
  });

  it('rejects non-square or incorrectly declared cover bytes before persistence', () => {
    expect(() => validateGameCoverBytes(png(64, 32), 'image/png')).toThrow(
      GameCurationError
    );
    expect(() => validateGameCoverBytes(png(64, 64), 'image/jpeg')).toThrow(
      GameCurationError
    );
    expect(() => validateGameCoverBytes(png(4097, 4097), 'image/png')).toThrow(
      'Cover dimensions must not exceed 4096 by 4096 pixels'
    );
  });
});
