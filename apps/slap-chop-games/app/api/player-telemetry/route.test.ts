import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

describe('POST /api/player-telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a bounded player-failure event and returns no content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await POST(
      new Request('https://games.taskmarket.dev/api/player-telemetry', {
        body: JSON.stringify({
          event: 'integrity_failure',
          reason: 'sha256_mismatch',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(warn).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'slap_chop.player_failure',
        outcome: 'failure',
        playerEvent: 'integrity_failure',
        reason: 'sha256_mismatch',
      })
    );
  });

  it('silently ignores unbounded or oversized payloads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const payload = JSON.stringify({
      event: 'integrity_failure',
      reason: 'sha256_mismatch',
      slug: 'must-not-log',
    });

    const invalid = await POST(
      new Request('https://games.taskmarket.dev/api/player-telemetry', {
        body: payload,
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    );
    const oversized = await POST(
      new Request('https://games.taskmarket.dev/api/player-telemetry', {
        body: 'x'.repeat(257),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    );

    expect(invalid.status).toBe(204);
    expect(oversized.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});
