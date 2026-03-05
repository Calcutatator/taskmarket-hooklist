import { describe, it, expect } from 'vitest';
import { AgentMessageEnvelopeSchema } from '../../src/schemas/xmtp.schemas';

const validEnvelope = {
  schemaVersion: 1,
  type: 'task.query',
  requestId: '3ca9253f-b16f-4ff5-b6db-7d3e123d89aa',
  senderInboxId: 'inbox-abc',
  senderAddress: '0x1111111111111111111111111111111111111111',
  sentAt: '2026-03-03T00:00:00.000Z',
  payload: { ping: true },
};

describe('AgentMessageEnvelopeSchema', () => {
  it('parses a valid envelope', () => {
    const parsed = AgentMessageEnvelopeSchema.parse(validEnvelope);
    expect(parsed.type).toBe('task.query');
    expect(parsed.schemaVersion).toBe(1);
  });

  it('rejects unsupported schemaVersion', () => {
    const result = AgentMessageEnvelopeSchema.safeParse({
      ...validEnvelope,
      schemaVersion: 2,
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid address, requestId, and sentAt', () => {
    const result = AgentMessageEnvelopeSchema.safeParse({
      ...validEnvelope,
      senderAddress: 'not-an-address',
      requestId: 'not-a-uuid',
      sentAt: 'not-a-date',
    });

    expect(result.success).toBe(false);
  });
});
