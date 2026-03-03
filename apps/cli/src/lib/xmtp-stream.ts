import type { AgentMessageEnvelope } from '@taskmarket/shared';

export interface DedupeCache {
  has: (key: string) => boolean;
  add: (key: string) => void;
}

export function createInMemoryDedupeCache(maxEntries = 5000): DedupeCache {
  const values = new Set<string>();
  const order: string[] = [];

  return {
    has: (key: string) => values.has(key),
    add: (key: string) => {
      if (values.has(key)) {
        return;
      }
      values.add(key);
      order.push(key);
      if (order.length > maxEntries) {
        const oldest = order.shift();
        if (oldest) {
          values.delete(oldest);
        }
      }
    },
  };
}

function dedupeKey(envelope: AgentMessageEnvelope): string {
  return `${envelope.senderInboxId}:${envelope.requestId}:${envelope.type}`;
}

export function shouldHandleEnvelope(
  envelope: AgentMessageEnvelope,
  options: {
    cache: DedupeCache;
    allowedTypes?: Set<string>;
  }
): boolean {
  if (options.allowedTypes && !options.allowedTypes.has(envelope.type)) {
    return false;
  }

  const key = dedupeKey(envelope);
  if (options.cache.has(key)) {
    return false;
  }

  options.cache.add(key);
  return true;
}

export interface RunStreamWithReconnectOptions {
  streamFactory: () => AsyncIterable<AgentMessageEnvelope>;
  onEnvelope: (envelope: AgentMessageEnvelope) => Promise<void> | void;
  shouldStop: () => boolean;
  maxReconnectAttempts?: number;
  backoffMs?: (attempt: number) => number;
  onReconnect?: (attempt: number, error: unknown) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runStreamWithReconnect(
  options: RunStreamWithReconnectOptions
): Promise<void> {
  const maxReconnectAttempts = options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
  const backoffMs =
    options.backoffMs ??
    ((attempt: number) => {
      const base = Math.min(30_000, 250 * 2 ** attempt);
      return base * (0.5 + Math.random() * 0.5);
    });

  let reconnectAttempt = 0;

  while (!options.shouldStop()) {
    try {
      const stream = options.streamFactory();
      for await (const envelope of stream) {
        if (options.shouldStop()) {
          return;
        }
        await options.onEnvelope(envelope);
        reconnectAttempt = 0;
      }
      if (options.shouldStop()) {
        return;
      }

      throw new Error('XMTP stream ended unexpectedly');
    } catch (error) {
      reconnectAttempt += 1;
      if (reconnectAttempt > maxReconnectAttempts) {
        throw error;
      }

      options.onReconnect?.(reconnectAttempt, error);
      await sleep(backoffMs(reconnectAttempt));
    }
  }
}
