import { describe, it, expect } from 'vitest';
import { buildEnvelope, parseEnvelope, encodeEnvelope, decodeEnvelope } from '../../src/lib/xmtp-envelope.js';

describe('xmtp-envelope', () => {
  it('builds an envelope with schemaVersion=1 and parse succeeds', () => {
    const envelope = buildEnvelope({
      type: 'task.query',
      senderInboxId: 'inbox-1',
      senderAddress: '0x1111111111111111111111111111111111111111',
      payload: { foo: 'bar' },
    });

    const parsed = parseEnvelope(envelope);

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.type).toBe('task.query');
  });

  it('encodes and decodes envelope JSON', () => {
    const envelope = buildEnvelope({
      type: 'task.query',
      senderInboxId: 'inbox-1',
      senderAddress: '0x1111111111111111111111111111111111111111',
      payload: { count: 1 },
    });

    const raw = encodeEnvelope(envelope);
    const decoded = decodeEnvelope(raw);

    expect(decoded.requestId).toBe(envelope.requestId);
  });

  it('rejects invalid schemaVersion', () => {
    expect(() =>
      parseEnvelope({
        schemaVersion: 2,
        type: 'task.query',
        requestId: '3ca9253f-b16f-4ff5-b6db-7d3e123d89aa',
        senderInboxId: 'inbox-1',
        senderAddress: '0x1111111111111111111111111111111111111111',
        sentAt: '2026-03-03T00:00:00.000Z',
        payload: {},
      })
    ).toThrow();
  });
});
