import { z } from 'zod';

const PLAYER_TELEMETRY_ENDPOINT = '/api/player-telemetry';

const PlayerTelemetryPayloadSchema = z
  .discriminatedUnion('event', [
    z
      .object({
        event: z.literal('artifact_refresh_failure'),
        reason: z.enum([
          'artifact_fetch_http_4xx',
          'artifact_fetch_http_5xx',
          'artifact_fetch_network',
          'catalog_invalid_response',
          'catalog_not_found',
          'catalog_unavailable',
        ]),
      })
      .strict(),
    z
      .object({
        event: z.literal('integrity_failure'),
        reason: z.literal('sha256_mismatch'),
      })
      .strict(),
    z
      .object({
        event: z.literal('runtime_failure'),
        reason: z.enum([
          'artifact_fetch_http_4xx',
          'artifact_fetch_http_5xx',
          'artifact_fetch_network',
          'declared_size_exceeded',
          'fetched_size_exceeded',
          'runtime_error',
          'unsupported_artifact',
        ]),
      })
      .strict(),
  ])
  .readonly();

export type PlayerTelemetryPayload = z.infer<typeof PlayerTelemetryPayloadSchema>;

export function parsePlayerTelemetryPayload(value: unknown): PlayerTelemetryPayload | null {
  const parsed = PlayerTelemetryPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Client telemetry is deliberately best-effort: a reporting failure must never delay, retry, or
// change the player. The fixed endpoint and enum-only payload keep this separate from catalog
// identifiers, artifact URLs, identity state, and game bytes.
export function reportPlayerTelemetry(payload: PlayerTelemetryPayload): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return;
  }

  try {
    void fetch(PLAYER_TELEMETRY_ENDPOINT, {
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        'content-type': 'application/json',
      },
      keepalive: true,
      method: 'POST',
      referrerPolicy: 'no-referrer',
    }).catch(() => undefined);
  } catch {
    // A hostile extension or browser failure cannot turn observability into a player failure.
  }
}
