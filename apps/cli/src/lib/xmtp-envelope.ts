import { randomUUID } from 'crypto';
import { AgentMessageEnvelopeSchema, type AgentMessageEnvelope } from '@taskmarket/shared';

export interface BuildEnvelopeInput {
  type: string;
  senderInboxId: string;
  senderAddress: string;
  payload: Record<string, unknown>;
  requestId?: string;
  replyToRequestId?: string;
  deadlineMs?: number;
}

export function buildEnvelope(input: BuildEnvelopeInput): AgentMessageEnvelope {
  return AgentMessageEnvelopeSchema.parse({
    schemaVersion: 1,
    type: input.type,
    requestId: input.requestId ?? randomUUID(),
    replyToRequestId: input.replyToRequestId,
    senderInboxId: input.senderInboxId,
    senderAddress: input.senderAddress,
    sentAt: new Date().toISOString(),
    deadlineMs: input.deadlineMs,
    payload: input.payload,
  });
}

export function parseEnvelope(value: unknown): AgentMessageEnvelope {
  return AgentMessageEnvelopeSchema.parse(value);
}

export function encodeEnvelope(envelope: AgentMessageEnvelope): string {
  return JSON.stringify(envelope);
}

export function decodeEnvelope(raw: string): AgentMessageEnvelope {
  const parsed: unknown = JSON.parse(raw);
  return parseEnvelope(parsed);
}
