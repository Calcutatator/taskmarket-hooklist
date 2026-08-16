import type { StorageBackend } from '../lib/storage';
import { getStorageBackend } from '../lib/storage';
import {
  logSlapChopArtifactDeliveryFailure,
  slapChopDurationMs,
  type SlapChopArtifactOperation,
} from '../lib/slap-chop-observability';

// Implements: ADR-0087
// Five minutes is enough for a catalog image or an initial game fetch while making a leaked URL
// short lived. A caller refreshes a delivery URL by reading the game again; raw storage URIs and
// object keys are never serialized into a catalog DTO.
export const GAME_DELIVERY_URL_TTL_SECONDS = 300;

export type GameDeliveryUrl = {
  expiresAt: string;
  url: string;
};

type DeliveryStorage = Pick<StorageBackend, 'getPresignedUrl'>;

export type GameDeliveryOptions = {
  now?: Date;
  operation?: SlapChopArtifactOperation;
  storage?: DeliveryStorage;
};

export async function getGameDeliveryUrl(
  storageUri: string | null,
  options: GameDeliveryOptions = {}
): Promise<GameDeliveryUrl | null> {
  if (!storageUri) return null;

  const startedAt = performance.now();
  try {
    const storage = options.storage ?? getStorageBackend();
    const now = options.now ?? new Date();
    const url = await storage.getPresignedUrl(storageUri, GAME_DELIVERY_URL_TTL_SECONDS);

    return {
      url,
      expiresAt: new Date(now.getTime() + GAME_DELIVERY_URL_TTL_SECONDS * 1_000).toISOString(),
    };
  } catch {
    // Public reads remain available when an object is temporarily unavailable. The UI receives a
    // typed null instead of a storage URI, key, or provider error that could disclose internals.
    logSlapChopArtifactDeliveryFailure({
      durationMs: slapChopDurationMs(startedAt),
      operation: options.operation ?? 'unspecified',
      reason: 'presign_failed',
    });
    return null;
  }
}
