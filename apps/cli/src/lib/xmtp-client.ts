import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type { AgentMessageEnvelope } from '@taskmarket/shared';
import { decodeEnvelope, encodeEnvelope } from './xmtp-envelope.js';
import { XmtpQueryManager } from './xmtp-query.js';
import {
  createInMemoryDedupeCache,
  runStreamWithReconnect,
  shouldHandleEnvelope,
} from './xmtp-stream.js';

interface InMemoryMessage {
  toInboxId: string;
  body: string;
}

const devMessageBus = new Map<string, InMemoryMessage[]>();

export interface XmtpClientSession {
  inboxId: string;
  installationId: string;
  dbPath: string;
  sendMessage: (toInboxId: string, body: string) => Promise<void>;
  streamMessages: (options?: { signal?: AbortSignal }) => AsyncIterable<string>;
}

export interface CreateXmtpClientInput {
  walletAddress: string;
  existingInboxId?: string;
  existingInstallationId?: string;
  existingDbPath?: string;
}

function defaultXmtpDbDir(): string {
  return process.env.TASKMARKET_XMTP_DB_DIR ?? path.join(os.homedir(), '.taskmarket', 'xmtp');
}

function defaultDbPath(walletAddress: string): string {
  const normalized = walletAddress.toLowerCase();
  return path.join(defaultXmtpDbDir(), `${normalized}.sqlite`);
}

async function createDevClient(input: CreateXmtpClientInput): Promise<XmtpClientSession> {
  const inboxId =
    input.existingInboxId ?? `dev-inbox-${input.walletAddress.slice(2, 10).toLowerCase()}`;
  const installationId = input.existingInstallationId ?? randomUUID();
  const dbPath = input.existingDbPath ?? defaultDbPath(input.walletAddress);

  return {
    inboxId,
    installationId,
    dbPath,
    async sendMessage(toInboxId: string, body: string) {
      const messages = devMessageBus.get(toInboxId) ?? [];
      messages.push({ toInboxId, body });
      devMessageBus.set(toInboxId, messages);
    },
    async *streamMessages(options?: { signal?: AbortSignal }) {
      while (!options?.signal?.aborted) {
        const messages = devMessageBus.get(inboxId) ?? [];
        if (messages.length > 0) {
          const next = messages.shift();
          devMessageBus.set(inboxId, messages);
          if (next) {
            yield next.body;
          }
          continue;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    },
  };
}

export async function createXmtpClient(input: CreateXmtpClientInput): Promise<XmtpClientSession> {
  // v1 ships with a development fallback so commands can still run in environments
  // where the XMTP Node SDK is not yet installed.
  const sdkModuleName = '@xmtp/node-sdk';

  if (process.env.TASKMARKET_XMTP_ENV === 'production') {
    try {
      await import(sdkModuleName);
    } catch {
      throw new Error('XMTP production mode requires @xmtp/node-sdk and runtime wiring');
    }

    throw new Error('Production XMTP runtime wiring is not enabled in this build yet');
  }

  return createDevClient(input);
}

export async function sendMessageEnvelope(
  client: XmtpClientSession,
  toInboxId: string,
  envelope: AgentMessageEnvelope
): Promise<void> {
  await client.sendMessage(toInboxId, encodeEnvelope(envelope));
}

export async function runQueryWithClient(options: {
  client: XmtpClientSession;
  toInboxId: string;
  envelope: AgentMessageEnvelope;
  timeoutMs: number;
}): Promise<AgentMessageEnvelope> {
  const abortController = new AbortController();
  const manager = new XmtpQueryManager();
  const pending = manager.waitForResponse(options.envelope.requestId, options.timeoutMs);

  await sendMessageEnvelope(options.client, options.toInboxId, options.envelope);

  const consumeResponses = (async () => {
    for await (const raw of options.client.streamMessages({ signal: abortController.signal })) {
      const envelope = decodeEnvelope(raw);
      if (manager.resolveResponse(envelope)) {
        break;
      }
    }
  })();

  void consumeResponses.catch(() => {
    // Pending promise controls timeout behavior; stream errors are non-fatal here.
  });

  try {
    return await pending;
  } finally {
    manager.clear();
    abortController.abort();
    await consumeResponses.catch(() => {
      // Query result is already resolved by pending promise.
    });
  }
}

export async function listenForEnvelopes(options: {
  client: XmtpClientSession;
  onEnvelope: (envelope: AgentMessageEnvelope) => Promise<void> | void;
  shouldStop: () => boolean;
  allowedTypes?: Set<string>;
}): Promise<void> {
  const dedupeCache = createInMemoryDedupeCache();

  await runStreamWithReconnect({
    streamFactory: async function* () {
      for await (const raw of options.client.streamMessages()) {
        yield decodeEnvelope(raw);
      }
    },
    shouldStop: options.shouldStop,
    onEnvelope: async (envelope) => {
      if (
        shouldHandleEnvelope(envelope, {
          cache: dedupeCache,
          allowedTypes: options.allowedTypes,
        })
      ) {
        await options.onEnvelope(envelope);
      }
    },
  });
}
