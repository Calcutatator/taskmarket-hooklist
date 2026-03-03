import { describe, it, expect, vi } from 'vitest';
import {
  createInMemoryDedupeCache,
  shouldHandleEnvelope,
  runStreamWithReconnect,
} from '../../src/lib/xmtp-stream.js';

const ENVELOPE = {
  schemaVersion: 1 as const,
  type: 'task.query',
  requestId: '3ca9253f-b16f-4ff5-b6db-7d3e123d89aa',
  senderInboxId: 'inbox-a',
  senderAddress: '0x1111111111111111111111111111111111111111',
  sentAt: '2026-03-03T00:00:00.000Z',
  payload: { ping: true },
};

describe('xmtp-stream', () => {
  it('deduplicates repeated message keys', () => {
    const cache = createInMemoryDedupeCache(10);

    const first = shouldHandleEnvelope(ENVELOPE, { cache });
    const second = shouldHandleEnvelope(ENVELOPE, { cache });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('filters by allowed types when provided', () => {
    const cache = createInMemoryDedupeCache(10);

    const allowed = shouldHandleEnvelope(ENVELOPE, {
      cache,
      allowedTypes: new Set(['task.query']),
    });
    const blocked = shouldHandleEnvelope(
      {
        ...ENVELOPE,
        requestId: '40c2da5a-0f61-4e20-a8af-df7aad9ab8a2',
        type: 'task.response',
      },
      { cache, allowedTypes: new Set(['task.query']) }
    );

    expect(allowed).toBe(true);
    expect(blocked).toBe(false);
  });

  it('reconnects stream after transient error', async () => {
    let firstAttempt = true;
    let stop = false;

    const streamFactory = vi.fn(async function* () {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error('transient');
      }
      yield ENVELOPE;
    });

    const onEnvelope = vi.fn(() => {
      stop = true;
    });

    await runStreamWithReconnect({
      streamFactory,
      onEnvelope,
      shouldStop: () => stop,
      maxReconnectAttempts: 2,
      backoffMs: () => 0,
    });

    expect(streamFactory).toHaveBeenCalledTimes(2);
    expect(onEnvelope).toHaveBeenCalledTimes(1);
  });
});
