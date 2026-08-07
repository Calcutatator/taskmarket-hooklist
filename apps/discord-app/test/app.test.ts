// Verifies: ADR-0041
import request from 'supertest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';

describe('Discord app HTTP service', () => {
  it('reports the deployed environment and version through the public health seam', async () => {
    const app = createApp({
      commitSha: 'abc123',
      deployEnvironment: 'test',
    });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      capabilities: { commands: [] },
      environment: 'test',
      status: 'ok',
      version: 'abc123',
    });
  });

  it('accepts a signed Discord PING through the public interaction seam', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyHex = publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(-32)
      .toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ id: 'ping-1', type: 1 });
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    const recordOperationalEvent = vi.fn();
    const app = createApp({
      commitSha: 'abc123',
      deployEnvironment: 'test',
      discordPublicKey: publicKeyHex,
      recordOperationalEvent,
    });

    const response = await request(app)
      .post('/interactions')
      .set('content-type', 'application/json')
      .set('x-signature-ed25519', signature)
      .set('x-signature-timestamp', timestamp)
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ type: 1 });
    expect(recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'discord_interaction', outcome: 'ok' })
    );
  });

  it('records the command result instead of treating every Discord response as successful', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyHex = publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(-32)
      .toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ id: 'command-1', type: 2, data: { name: 'task' } });
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');
    const recordOperationalEvent = vi.fn();
    const app = createApp({
      commandDispatcher: async (_interaction, recordOutcome) => {
        recordOutcome?.('upstream_unavailable');
        return { type: 4 };
      },
      commitSha: 'abc123',
      deployEnvironment: 'test',
      discordPublicKey: publicKeyHex,
      recordOperationalEvent,
    });

    const response = await request(app)
      .post('/interactions')
      .set('content-type', 'application/json')
      .set('x-signature-ed25519', signature)
      .set('x-signature-timestamp', timestamp)
      .send(body);

    expect(response.status).toBe(200);
    expect(recordOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'task',
        event: 'discord_interaction',
        outcome: 'upstream_unavailable',
      })
    );
  });

  it('rejects an unsigned interaction before parsing it', async () => {
    const app = createApp({
      commitSha: 'abc123',
      deployEnvironment: 'test',
      discordPublicKey: '00'.repeat(32),
    });

    const response = await request(app)
      .post('/interactions')
      .set('content-type', 'application/json')
      .send('{not-json');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid interaction signature' });
  });
});
