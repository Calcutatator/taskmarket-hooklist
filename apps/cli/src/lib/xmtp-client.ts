import os from 'os';
import path from 'path';
import { randomUUID, hkdfSync } from 'crypto';
import { privateKeyToAccount } from 'viem/accounts';
import type { AgentMessageEnvelope } from '@taskmarket/shared';
import type { Keystore } from './keystore.js';
import { decryptPrivateKey } from './keystore.js';
import { fetchDeviceKey } from './signer.js';
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

// Module-level singleton bus for the dev/test fallback client.
// All createDevClient instances in the same process share this bus — intentional
// for local two-agent testing, but tests must not rely on bus state being clean
// unless they consume or reset messages from previous operations.
const devMessageBus = new Map<string, InMemoryMessage[]>();

const DEFAULT_SEND_RETRY_ATTEMPTS = 3;
const DEFAULT_SEND_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_SEND_RETRY_MAX_DELAY_MS = 30_000;

type XmtpClientFactory = (...args: unknown[]) => Promise<unknown>;
type TransportErrorCategory = 'retryable' | 'non-retryable' | 'timeout';

export class XmtpTransportError extends Error {
  readonly category: TransportErrorCategory;
  readonly retryable: boolean;
  readonly originalError: unknown;

  constructor(message: string, category: TransportErrorCategory, originalError?: unknown) {
    super(message);
    this.name = 'XmtpTransportError';
    this.category = category;
    this.retryable = category === 'retryable';
    this.originalError = originalError;
  }
}

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
  keystore?: Keystore;
  runtimeSigner?: unknown;
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

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
}

function extractString(value: unknown, keys: string[]): string | undefined {
  const objectValue = asObject(value);
  if (!objectValue) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = objectValue[key];
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

function readNumber(value: unknown, keys: string[]): number | undefined {
  const objectValue = asObject(value);
  if (!objectValue) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = objectValue[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function readMessageText(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  const objectValue = asObject(message);
  if (!objectValue) {
    throw new XmtpTransportError(
      'XMTP message payload is not a string and cannot be decoded',
      'non-retryable',
      message
    );
  }

  for (const key of ['body', 'content', 'message']) {
    const candidate = objectValue[key];
    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  for (const key of ['body', 'content']) {
    const candidate = objectValue[key];
    if (candidate instanceof Uint8Array) {
      return Buffer.from(candidate).toString('utf8');
    }
  }

  throw new XmtpTransportError(
    'XMTP message payload does not expose a readable body/content field',
    'non-retryable',
    message
  );
}

function classifyTransportError(error: unknown): TransportErrorCategory {
  const objectValue = asObject(error);
  const status =
    readNumber(error, ['status', 'statusCode']) ??
    (typeof objectValue?.responseStatus === 'number' ? objectValue.responseStatus : undefined);
  const code = extractString(error, ['code', 'errorCode'])?.toLowerCase();
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (message.includes('timed out') && message.includes('query')) {
    return 'timeout';
  }

  if (
    status === 429 ||
    (typeof status === 'number' && status >= 500) ||
    code === 'etimedout' ||
    code === 'econnreset' ||
    code === 'eai_again' ||
    code === 'rate_limit_exceeded' ||
    code === 'rate_limited' ||
    message.includes('rate limit') ||
    message.includes('temporarily unavailable') ||
    message.includes('connection reset') ||
    message.includes('network error') ||
    message.includes('transient')
  ) {
    return 'retryable';
  }

  return 'non-retryable';
}

function toTransportError(error: unknown, fallbackMessage: string): XmtpTransportError {
  if (error instanceof XmtpTransportError) {
    return error;
  }

  const category = classifyTransportError(error);
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : `${fallbackMessage} (${String(error)})`;
  return new XmtpTransportError(message, category, error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAttempts(): number {
  const raw = process.env.TASKMARKET_XMTP_SEND_MAX_ATTEMPTS;
  if (!raw) {
    return DEFAULT_SEND_RETRY_ATTEMPTS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SEND_RETRY_ATTEMPTS;
  }

  return Math.floor(parsed);
}

function sendBackoffMs(attempt: number): number {
  const base = DEFAULT_SEND_RETRY_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0);
  const jitter = Math.floor(Math.random() * DEFAULT_SEND_RETRY_BASE_DELAY_MS);
  return Math.min(DEFAULT_SEND_RETRY_MAX_DELAY_MS, base + jitter);
}

async function withRetry<T>(operation: () => Promise<T>, maxAttempts: number): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const mapped = toTransportError(error, 'XMTP transport operation failed');
      if (!mapped.retryable || attempt >= maxAttempts) {
        throw mapped;
      }

      await sleep(sendBackoffMs(attempt));
    }
  }

  throw new XmtpTransportError('XMTP retry attempts exhausted', 'non-retryable');
}

function resolveClientFactory(moduleValue: unknown): XmtpClientFactory | undefined {
  const moduleObject = asObject(moduleValue);
  if (!moduleObject) {
    return undefined;
  }

  const clientExport = Object.prototype.hasOwnProperty.call(moduleObject, 'Client')
    ? moduleObject.Client
    : undefined;
  const clientObject = asObject(clientExport);
  const fromClient = clientObject?.create;
  if (typeof fromClient === 'function') {
    return fromClient as XmtpClientFactory;
  }

  const createClient = Object.prototype.hasOwnProperty.call(moduleObject, 'createClient')
    ? moduleObject.createClient
    : undefined;
  if (typeof createClient === 'function') {
    return createClient as XmtpClientFactory;
  }

  return undefined;
}

async function createSdkClient(
  factory: XmtpClientFactory,
  signer: unknown,
  options: Record<string, unknown>
): Promise<unknown> {
  const callVariants: Array<unknown[]> = [[signer, options], [{ signer, ...options }], [options]];

  let lastError: unknown;
  for (const args of callVariants) {
    try {
      return await factory(...args);
    } catch (error) {
      lastError = error;
    }
  }

  throw toTransportError(lastError, 'Failed to initialize XMTP SDK client');
}

function deriveXmtpDbKey(dekHex: string): Uint8Array {
  const ikm = Buffer.from(dekHex, 'hex');
  const derived = hkdfSync('sha256', ikm, '', 'taskmarket-xmtp-db', 32);
  return new Uint8Array(derived);
}

async function sendViaConversation(
  client: Record<string, unknown>,
  toInboxId: string,
  body: string
) {
  const conversations = asObject(client.conversations);
  if (!conversations) {
    throw new XmtpTransportError(
      'XMTP SDK client does not expose conversation APIs for outbound messaging',
      'non-retryable'
    );
  }

  const conversationFactoryNames = [
    'newConversation',
    'newDm',
    'getConversationByInboxId',
    'getDmByInboxId',
    'findOrCreateConversation',
    'findOrCreateDm',
  ];

  let conversation: unknown;
  for (const key of conversationFactoryNames) {
    const candidate = conversations[key];
    if (typeof candidate !== 'function') {
      continue;
    }

    conversation = await candidate.call(conversations, toInboxId);
    if (conversation) {
      break;
    }
  }

  const conversationObject = asObject(conversation);
  if (!conversationObject) {
    throw new XmtpTransportError(
      `XMTP conversation for inbox ${toInboxId} could not be created`,
      'non-retryable'
    );
  }

  for (const key of ['send', 'publishMessage']) {
    const send = conversationObject[key];
    if (typeof send === 'function') {
      await send.call(conversationObject, body);
      return;
    }
  }

  throw new XmtpTransportError(
    'XMTP conversation object does not expose a send method',
    'non-retryable'
  );
}

async function sendWithSdkClient(client: unknown, toInboxId: string, body: string): Promise<void> {
  const clientObject = asObject(client);
  if (!clientObject) {
    throw new XmtpTransportError('XMTP SDK client handle is invalid', 'non-retryable', client);
  }

  const directSendNames = ['sendMessage', 'publishMessage'];
  for (const key of directSendNames) {
    const send = clientObject[key];
    if (typeof send === 'function') {
      await send.call(clientObject, toInboxId, body);
      return;
    }
  }

  await sendViaConversation(clientObject, toInboxId, body);
}

async function* iterateCatchUpMessages(client: unknown): AsyncIterable<string> {
  const clientObject = asObject(client);
  if (!clientObject) {
    return;
  }

  const syncMethodNames = ['syncAllMessages', 'listMessages'];
  for (const key of syncMethodNames) {
    const method = clientObject[key];
    if (typeof method !== 'function') {
      continue;
    }

    const result = await method.call(clientObject);
    if (!result) {
      return;
    }

    if (typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      for await (const message of result as AsyncIterable<unknown>) {
        yield readMessageText(message);
      }
      return;
    }

    if (typeof (result as Iterable<unknown>)[Symbol.iterator] === 'function') {
      for (const message of result as Iterable<unknown>) {
        yield readMessageText(message);
      }
      return;
    }

    yield readMessageText(result);
    return;
  }
}

async function* iterateRealtimeMessages(
  client: unknown,
  options?: { signal?: AbortSignal }
): AsyncIterable<string> {
  const clientObject = asObject(client);
  if (!clientObject) {
    throw new XmtpTransportError('XMTP SDK client handle is invalid', 'non-retryable', client);
  }

  const streamMethodNames = ['streamAllMessages', 'streamMessages'];
  for (const key of streamMethodNames) {
    const method = clientObject[key];
    if (typeof method !== 'function') {
      continue;
    }

    const stream = await method.call(clientObject, options);
    if (typeof (stream as AsyncIterable<unknown>)?.[Symbol.asyncIterator] === 'function') {
      for await (const message of stream as AsyncIterable<unknown>) {
        if (options?.signal?.aborted) {
          return;
        }
        yield readMessageText(message);
      }
      return;
    }
  }

  const conversations = asObject(clientObject.conversations);
  if (conversations) {
    const method = conversations.streamAllMessages;
    if (typeof method === 'function') {
      const stream = await method.call(conversations, options);
      if (typeof (stream as AsyncIterable<unknown>)?.[Symbol.asyncIterator] === 'function') {
        for await (const message of stream as AsyncIterable<unknown>) {
          if (options?.signal?.aborted) {
            return;
          }
          yield readMessageText(message);
        }
        return;
      }
    }
  }

  throw new XmtpTransportError(
    'XMTP SDK client does not expose a compatible message stream API',
    'non-retryable'
  );
}

async function createProductionClient(input: CreateXmtpClientInput): Promise<XmtpClientSession> {
  let sdkModule: unknown;
  try {
    sdkModule = await import('@xmtp/node-sdk');
  } catch (error) {
    throw new XmtpTransportError(
      'XMTP production mode requires @xmtp/node-sdk dependency to be installed',
      'non-retryable',
      error
    );
  }

  const clientFactory = resolveClientFactory(sdkModule);
  if (!clientFactory) {
    throw new XmtpTransportError(
      'XMTP production mode SDK does not expose a compatible client factory',
      'non-retryable'
    );
  }

  let signer: unknown;
  let dbEncryptionKey: Uint8Array | undefined;

  if (input.runtimeSigner) {
    signer = input.runtimeSigner;
  } else if (input.keystore) {
    const dek = await fetchDeviceKey(input.keystore.deviceId, input.keystore.apiToken);
    const privateKey = decryptPrivateKey(dek, input.keystore.encryptedKey);
    signer = privateKeyToAccount(privateKey as `0x${string}`);
    dbEncryptionKey = deriveXmtpDbKey(dek);
  } else {
    throw new XmtpTransportError(
      'XMTP production mode requires keystore-backed signer material',
      'non-retryable'
    );
  }

  const dbPath = input.existingDbPath ?? defaultDbPath(input.walletAddress);
  const client = await createSdkClient(clientFactory, signer, {
    env: 'production',
    dbPath,
    dbEncryptionKey,
    inboxId: input.existingInboxId,
    installationId: input.existingInstallationId,
  });

  const inboxId =
    extractString(client, ['inboxId', 'inboxID']) ??
    extractString(asObject(client)?.inboxState, ['inboxId']) ??
    input.existingInboxId;
  if (!inboxId) {
    throw new XmtpTransportError(
      'XMTP SDK client did not return an inboxId in production mode',
      'non-retryable'
    );
  }

  const installationId =
    extractString(client, ['installationId', 'installationID']) ??
    extractString(asObject(client)?.installation, ['id', 'installationId']) ??
    input.existingInstallationId ??
    randomUUID();

  return {
    inboxId,
    installationId,
    dbPath,
    async sendMessage(toInboxId: string, body: string) {
      await withRetry(() => sendWithSdkClient(client, toInboxId, body), parseRetryAttempts());
    },
    async *streamMessages(options?: { signal?: AbortSignal }) {
      for await (const message of iterateCatchUpMessages(client)) {
        if (options?.signal?.aborted) {
          return;
        }
        yield message;
      }

      for await (const message of iterateRealtimeMessages(client, options)) {
        if (options?.signal?.aborted) {
          return;
        }
        yield message;
      }
    },
  };
}

export async function createXmtpClient(input: CreateXmtpClientInput): Promise<XmtpClientSession> {
  if (process.env.TASKMARKET_XMTP_ENV === 'production') {
    return createProductionClient(input);
  }

  return createDevClient(input);
}

export async function sendMessageEnvelope(
  client: XmtpClientSession,
  toInboxId: string,
  envelope: AgentMessageEnvelope
): Promise<void> {
  try {
    await client.sendMessage(toInboxId, encodeEnvelope(envelope));
  } catch (error) {
    throw toTransportError(error, 'XMTP send failed');
  }
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
  let streamError: unknown;

  await sendMessageEnvelope(options.client, options.toInboxId, options.envelope);

  const consumeResponses = (async () => {
    try {
      for await (const raw of options.client.streamMessages({ signal: abortController.signal })) {
        let envelope: AgentMessageEnvelope;
        try {
          envelope = decodeEnvelope(raw);
        } catch {
          // Malformed message — skip and continue consuming
          continue;
        }
        if (manager.resolveResponse(envelope)) {
          break;
        }
      }
    } catch (error) {
      streamError = error;
      manager.clear();
    }
  })();

  try {
    return await pending;
  } catch (error) {
    if (streamError) {
      throw toTransportError(streamError, 'XMTP query stream failed before response');
    }

    throw new XmtpTransportError(
      `XMTP query timed out after ${options.timeoutMs}ms`,
      'timeout',
      error
    );
  } finally {
    manager.clear();
    abortController.abort();
    await consumeResponses.catch(() => {
      // Query completion is controlled by pending promise.
    });
  }
}

export async function listenForEnvelopes(options: {
  client: XmtpClientSession;
  onEnvelope: (envelope: AgentMessageEnvelope) => Promise<void> | void;
  shouldStop: () => boolean;
  allowedTypes?: Set<string>;
  signal?: AbortSignal;
}): Promise<void> {
  const dedupeCache = createInMemoryDedupeCache();

  await runStreamWithReconnect({
    streamFactory: async function* () {
      for await (const raw of options.client.streamMessages({ signal: options.signal })) {
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
