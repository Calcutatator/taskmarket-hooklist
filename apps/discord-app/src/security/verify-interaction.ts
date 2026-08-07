// Implements: ADR-0041
import { createPublicKey, verify } from 'node:crypto';
import type { DiscordInteraction } from '../interactions/types';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DEFAULT_FRESHNESS_SECONDS = 300;

export interface VerifyInteractionInput {
  body: Buffer;
  publicKeyHex: string;
  signatureHex: string;
  timestamp: string;
  nowMs?: number;
  freshnessSeconds?: number;
}

function isHex(value: string, bytes: number): boolean {
  return value.length === bytes * 2 && /^[a-fA-F0-9]+$/.test(value);
}

export function verifyInteractionRequest(input: VerifyInteractionInput): boolean {
  if (!isHex(input.publicKeyHex, 32) || !isHex(input.signatureHex, 64)) return false;

  const timestampSeconds = Number(input.timestamp);
  if (!Number.isInteger(timestampSeconds)) return false;

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const freshnessSeconds = input.freshnessSeconds ?? DEFAULT_FRESHNESS_SECONDS;
  if (Math.abs(nowSeconds - timestampSeconds) > freshnessSeconds) return false;

  try {
    const publicKey = createPublicKey({
      format: 'der',
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(input.publicKeyHex, 'hex')]),
      type: 'spki',
    });
    return verify(
      null,
      Buffer.concat([Buffer.from(input.timestamp), input.body]),
      publicKey,
      Buffer.from(input.signatureHex, 'hex')
    );
  } catch {
    return false;
  }
}

export function parseInteraction(body: Buffer): DiscordInteraction {
  const parsed: unknown = JSON.parse(body.toString('utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid interaction body');

  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.type !== 'number') {
    throw new Error('Invalid interaction body');
  }

  return parsed as DiscordInteraction;
}
