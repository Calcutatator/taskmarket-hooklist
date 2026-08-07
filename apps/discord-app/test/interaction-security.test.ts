// Verifies: ADR-0041
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseInteraction, verifyInteractionRequest } from '../src/security/verify-interaction';
import { dispatchInteraction } from '../src/interactions/dispatch';

function signingFixture(body: string, timestamp = Math.floor(Date.now() / 1000).toString()) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const publicKeyHex = publicKeyDer.subarray(-32).toString('hex');
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
  return { publicKeyHex, signature, timestamp };
}

describe('Discord interaction security seam', () => {
  it('accepts a correctly signed fresh request and dispatches Discord PING', async () => {
    const body = JSON.stringify({ id: '1', type: 1 });
    const fixture = signingFixture(body);

    expect(
      verifyInteractionRequest({
        body: Buffer.from(body),
        publicKeyHex: fixture.publicKeyHex,
        signatureHex: fixture.signature,
        timestamp: fixture.timestamp,
      })
    ).toBe(true);

    await expect(dispatchInteraction(parseInteraction(Buffer.from(body)))).resolves.toEqual({
      type: 1,
    });
  });

  it('rejects stale and tampered interaction signatures', () => {
    const body = JSON.stringify({ id: '1', type: 1 });
    const staleTimestamp = Math.floor(Date.now() / 1000 - 601).toString();
    const fixture = signingFixture(body, staleTimestamp);

    expect(
      verifyInteractionRequest({
        body: Buffer.from(body),
        publicKeyHex: fixture.publicKeyHex,
        signatureHex: fixture.signature,
        timestamp: fixture.timestamp,
      })
    ).toBe(false);
    expect(
      verifyInteractionRequest({
        body: Buffer.from(body + ' '),
        publicKeyHex: fixture.publicKeyHex,
        signatureHex: fixture.signature,
        timestamp: fixture.timestamp,
        nowMs: Number(staleTimestamp) * 1000,
      })
    ).toBe(false);
  });
});
