import { describe, it, expect, vi } from 'vitest';
import { runQueryWithClient } from '../../src/lib/xmtp-client.js';
import { buildEnvelope } from '../../src/lib/xmtp-envelope.js';

describe('xmtp-client', () => {
  it('cancels response stream after query timeout', async () => {
    let streamClosed = false;

    const client = {
      inboxId: 'inbox-a',
      installationId: 'install-a',
      dbPath: '/tmp/a.sqlite',
      sendMessage: async () => {},
      async *streamMessages(options?: { signal?: AbortSignal }) {
        try {
          await new Promise<void>((resolve) => {
            options?.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
        } finally {
          streamClosed = true;
        }
      },
    };

    const envelope = buildEnvelope({
      type: 'task.query',
      senderInboxId: 'inbox-a',
      senderAddress: '0x1111111111111111111111111111111111111111',
      payload: { ping: true },
    });

    await expect(
      runQueryWithClient({
        client,
        toInboxId: 'inbox-b',
        envelope,
        timeoutMs: 10,
      })
    ).rejects.toThrow('timed out');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(streamClosed).toBe(true);
  });

  it('returns explicit wiring error when production XMTP SDK import succeeds', async () => {
    const previousEnv = process.env.TASKMARKET_XMTP_ENV;

    try {
      process.env.TASKMARKET_XMTP_ENV = 'production';
      vi.resetModules();
      vi.doMock('@xmtp/node-sdk', () => ({}), { virtual: true });

      const { createXmtpClient } = await import('../../src/lib/xmtp-client.js');

      await expect(
        createXmtpClient({
          walletAddress: '0x1111111111111111111111111111111111111111',
        })
      ).rejects.toThrow('Production XMTP runtime wiring is not enabled in this build yet');
    } finally {
      vi.doUnmock('@xmtp/node-sdk');
      vi.resetModules();
      if (previousEnv === undefined) {
        delete process.env.TASKMARKET_XMTP_ENV;
      } else {
        process.env.TASKMARKET_XMTP_ENV = previousEnv;
      }
    }
  });
});
