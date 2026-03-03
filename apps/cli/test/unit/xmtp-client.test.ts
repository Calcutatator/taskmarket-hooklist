import { describe, it, expect, vi } from 'vitest';
import {
  createXmtpClient,
  runQueryWithClient,
  sendMessageEnvelope,
  XmtpTransportError,
} from '../../src/lib/xmtp-client.js';
import { buildEnvelope, encodeEnvelope } from '../../src/lib/xmtp-envelope.js';

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
    ).rejects.toMatchObject({
      name: XmtpTransportError.name,
      category: 'timeout',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(streamClosed).toBe(true);
  });

  it('skips malformed messages and resolves on the next valid response', async () => {
    const requestEnvelope = buildEnvelope({
      type: 'task.query',
      senderInboxId: 'inbox-a',
      senderAddress: '0x1111111111111111111111111111111111111111',
      payload: { ping: true },
    });

    const responseEnvelope = buildEnvelope({
      type: 'task.response',
      senderInboxId: 'inbox-b',
      senderAddress: '0x2222222222222222222222222222222222222222',
      replyToRequestId: requestEnvelope.requestId,
      payload: { pong: true },
    });

    const rawMessages = ['not-valid-json', '{"bad":"schema"}', encodeEnvelope(responseEnvelope)];

    const client = {
      inboxId: 'inbox-a',
      installationId: 'install-a',
      dbPath: '/tmp/a.sqlite',
      sendMessage: async () => {},
      async *streamMessages(_options?: { signal?: AbortSignal }) {
        for (const msg of rawMessages) {
          yield msg;
        }
      },
    };

    const result = await runQueryWithClient({
      client,
      toInboxId: 'inbox-b',
      envelope: requestEnvelope,
      timeoutMs: 500,
    });

    expect(result.replyToRequestId).toBe(requestEnvelope.requestId);
  });

  it('initializes SDK-backed client in production mode', async () => {
    const previousEnv = process.env.TASKMARKET_XMTP_ENV;
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const createClient = vi.fn().mockResolvedValue({
      inboxId: 'prod-inbox-1',
      installationId: 'prod-install-1',
      sendMessage,
      async *streamAllMessages() {},
    });

    try {
      process.env.TASKMARKET_XMTP_ENV = 'production';
      vi.resetModules();
      vi.doMock(
        '@xmtp/node-sdk',
        () => ({
          Client: {
            create: createClient,
          },
        }),
        { virtual: true }
      );

      const client = await createXmtpClient({
        walletAddress: '0x1111111111111111111111111111111111111111',
        runtimeSigner: {} as never,
      });

      expect(client.inboxId).toBe('prod-inbox-1');
      expect(client.installationId).toBe('prod-install-1');
      expect(createClient).toHaveBeenCalledTimes(1);

      await client.sendMessage('peer-inbox', '{"ok":true}');
      expect(sendMessage).toHaveBeenCalledWith('peer-inbox', '{"ok":true}');
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

  it('surfaces clear error when production SDK shape is incompatible', async () => {
    const previousEnv = process.env.TASKMARKET_XMTP_ENV;

    try {
      process.env.TASKMARKET_XMTP_ENV = 'production';
      vi.resetModules();
      vi.doMock('@xmtp/node-sdk', () => ({ Client: {} }), { virtual: true });

      await expect(
        createXmtpClient({
          walletAddress: '0x1111111111111111111111111111111111111111',
          runtimeSigner: {} as never,
        })
      ).rejects.toThrow('does not expose a compatible client factory');
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

  it('retries retryable production send failures', async () => {
    const previousEnv = process.env.TASKMARKET_XMTP_ENV;
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('temporary timeout'), { code: 'ETIMEDOUT' }))
      .mockResolvedValue(undefined);
    const createClient = vi.fn().mockResolvedValue({
      inboxId: 'prod-inbox-1',
      installationId: 'prod-install-1',
      sendMessage,
      async *streamAllMessages() {},
    });

    try {
      process.env.TASKMARKET_XMTP_ENV = 'production';
      vi.resetModules();
      vi.doMock(
        '@xmtp/node-sdk',
        () => ({
          Client: {
            create: createClient,
          },
        }),
        { virtual: true }
      );

      const client = await createXmtpClient({
        walletAddress: '0x1111111111111111111111111111111111111111',
        runtimeSigner: {} as never,
      });
      const envelope = buildEnvelope({
        type: 'task.query',
        senderInboxId: 'inbox-a',
        senderAddress: '0x1111111111111111111111111111111111111111',
        payload: { ping: true },
      });
      await sendMessageEnvelope(client, 'inbox-b', envelope);

      expect(sendMessage).toHaveBeenCalledTimes(2);
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

  it('streams catch-up and realtime messages in production mode', async () => {
    const previousEnv = process.env.TASKMARKET_XMTP_ENV;
    const catchUpEnvelope = buildEnvelope({
      type: 'task.query',
      requestId: '3ca9253f-b16f-4ff5-b6db-7d3e123d89aa',
      senderInboxId: 'inbox-a',
      senderAddress: '0x1111111111111111111111111111111111111111',
      payload: { phase: 'catchup' },
    });
    const realtimeEnvelope = buildEnvelope({
      type: 'task.query',
      requestId: '40c2da5a-0f61-4e20-a8af-df7aad9ab8a2',
      senderInboxId: 'inbox-a',
      senderAddress: '0x1111111111111111111111111111111111111111',
      payload: { phase: 'realtime' },
    });
    const createClient = vi.fn().mockResolvedValue({
      inboxId: 'prod-inbox-1',
      installationId: 'prod-install-1',
      sendMessage: vi.fn(),
      syncAllMessages: vi.fn().mockResolvedValue([{ body: encodeEnvelope(catchUpEnvelope) }]),
      async *streamAllMessages() {
        yield { body: encodeEnvelope(realtimeEnvelope) };
      },
    });

    try {
      process.env.TASKMARKET_XMTP_ENV = 'production';
      vi.resetModules();
      vi.doMock(
        '@xmtp/node-sdk',
        () => ({
          Client: {
            create: createClient,
          },
        }),
        { virtual: true }
      );

      const client = await createXmtpClient({
        walletAddress: '0x1111111111111111111111111111111111111111',
        runtimeSigner: {} as never,
      });

      const streamed: string[] = [];
      for await (const raw of client.streamMessages()) {
        streamed.push(raw);
        if (streamed.length >= 2) {
          break;
        }
      }

      expect(streamed).toEqual([encodeEnvelope(catchUpEnvelope), encodeEnvelope(realtimeEnvelope)]);
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

  it('passes dbEncryptionKey derived from DEK when keystore is provided', async () => {
    const previousEnv = process.env.TASKMARKET_XMTP_ENV;
    const FAKE_DEK = 'ab'.repeat(32); // 32-byte hex string

    const createClient = vi.fn().mockResolvedValue({
      inboxId: 'inbox-1',
      installationId: 'install-1',
      sendMessage: vi.fn(),
      async *streamAllMessages() {},
    });

    try {
      process.env.TASKMARKET_XMTP_ENV = 'production';
      vi.resetModules();
      vi.doMock('@xmtp/node-sdk', () => ({ Client: { create: createClient } }), { virtual: true });
      vi.doMock('../../src/lib/signer.js', () => ({
        fetchDeviceKey: vi.fn().mockResolvedValue(FAKE_DEK),
      }));
      vi.doMock('../../src/lib/keystore.js', () => ({
        decryptPrivateKey: vi.fn().mockReturnValue('0x' + 'aa'.repeat(32)),
      }));
      vi.doMock('viem/accounts', () => ({
        privateKeyToAccount: vi.fn().mockReturnValue({
          type: 'local',
          signMessage: vi.fn(),
          signTypedData: vi.fn(),
        }),
      }));

      const { createXmtpClient } = await import('../../src/lib/xmtp-client.js');
      await createXmtpClient({
        walletAddress: '0x1111111111111111111111111111111111111111',
        keystore: {
          encryptedKey: 'deadbeef',
          walletAddress: '0x1111111111111111111111111111111111111111',
          deviceId: 'device-1',
          apiToken: 'token-1',
          agentId: null,
        },
      });

      // The SDK factory is called with (signer, options) or ({signer, ...options})
      const allArgs = createClient.mock.calls[0] ?? [];
      const options =
        allArgs.find(
          (a): a is Record<string, unknown> =>
            typeof a === 'object' && a !== null && 'dbEncryptionKey' in a
        ) ?? {};

      expect(options.dbEncryptionKey).toBeInstanceOf(Uint8Array);
      expect((options.dbEncryptionKey as Uint8Array).length).toBe(32);
    } finally {
      vi.doUnmock('@xmtp/node-sdk');
      vi.doUnmock('../../src/lib/signer.js');
      vi.doUnmock('../../src/lib/keystore.js');
      vi.doUnmock('viem/accounts');
      vi.resetModules();
      if (previousEnv === undefined) {
        delete process.env.TASKMARKET_XMTP_ENV;
      } else {
        process.env.TASKMARKET_XMTP_ENV = previousEnv;
      }
    }
  });
});
