import { afterEach, describe, expect, it, vi } from 'vitest';

import { parsePlayerTelemetryPayload, reportPlayerTelemetry } from './player-telemetry';

describe('player telemetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts only the fixed enum payload without browser credentials or a referrer', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);

    reportPlayerTelemetry({
      event: 'artifact_refresh_failure',
      reason: 'artifact_fetch_http_4xx',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/player-telemetry',
      expect.objectContaining({
        body: JSON.stringify({
          event: 'artifact_refresh_failure',
          reason: 'artifact_fetch_http_4xx',
        }),
        cache: 'no-store',
        credentials: 'omit',
        keepalive: true,
        method: 'POST',
        referrerPolicy: 'no-referrer',
      })
    );
  });

  it('rejects payloads with identifiers or unapproved failure values before they reach logging', () => {
    expect(
      parsePlayerTelemetryPayload({
        event: 'integrity_failure',
        reason: 'sha256_mismatch',
        slug: 'silent-orbit',
      })
    ).toBeNull();
    expect(
      parsePlayerTelemetryPayload({
        event: 'integrity_failure',
        reason: 'other',
      })
    ).toBeNull();
  });

  it('does not throw when reporting is blocked by the browser', () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('blocked');
    });

    expect(() =>
      reportPlayerTelemetry({ event: 'integrity_failure', reason: 'sha256_mismatch' })
    ).not.toThrow();
  });
});
