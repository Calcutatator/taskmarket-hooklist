import { READ_AUTH_ADDRESS_HEADER, READ_AUTH_SIGNATURE_HEADER } from '@taskmarket/shared';

import {
  getSessionStorageItem,
  removeSessionStorageItem,
  setSessionStorageItem,
} from './safe-session-storage';

// Browser-session cache for the general read-auth headers (ADR-0016/ADR-0023):
// at most one signed proof is held at a time, for whichever wallet is
// currently connected. `makeTrpcClient` (api/client.tsx) reads this on every
// request so any endpoint that cares about ctx.caller picks it up, without
// each query needing to thread headers through itself. Session storage keeps
// that proof through a document reload while logout, wallet switching, and
// closing the tab still provide explicit cache boundaries.

const READ_AUTH_SESSION_KEY = 'taskmarket:read-auth';

type CachedReadAuth = { address: string; headers: Record<string, string> };
type StoredReadAuth = CachedReadAuth & { version: 1 };

let cachedReadAuth: CachedReadAuth | null = null;
let pendingReadAuth: {
  address: string;
  promise: Promise<Record<string, string>>;
} | null = null;
let sessionGeneration = 0;
const consumerAddresses = new Map<object, string | null>();

function isStoredReadAuth(value: unknown): value is StoredReadAuth {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredReadAuth>;
  const addressHeader = candidate.headers?.[READ_AUTH_ADDRESS_HEADER];
  const signatureHeader = candidate.headers?.[READ_AUTH_SIGNATURE_HEADER];
  return (
    candidate.version === 1 &&
    typeof candidate.address === 'string' &&
    /^0x[0-9a-f]{40}$/i.test(candidate.address) &&
    typeof addressHeader === 'string' &&
    addressHeader.toLowerCase() === candidate.address.toLowerCase() &&
    typeof signatureHeader === 'string' &&
    signatureHeader.length > 0
  );
}

function readSessionReadAuth(): CachedReadAuth | null {
  const stored = getSessionStorageItem(READ_AUTH_SESSION_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (isStoredReadAuth(parsed)) {
      return {
        address: parsed.address.toLowerCase(),
        headers: {
          [READ_AUTH_ADDRESS_HEADER]: parsed.headers[READ_AUTH_ADDRESS_HEADER],
          [READ_AUTH_SIGNATURE_HEADER]: parsed.headers[READ_AUTH_SIGNATURE_HEADER],
        },
      };
    }
  } catch {
    // Invalid session data is cleared below.
  }
  removeSessionStorageItem(READ_AUTH_SESSION_KEY);
  return null;
}

function currentCachedReadAuth(): CachedReadAuth | null {
  cachedReadAuth ??= readSessionReadAuth();
  return cachedReadAuth;
}

function persistReadAuth(value: CachedReadAuth): void {
  setSessionStorageItem(
    READ_AUTH_SESSION_KEY,
    JSON.stringify({ ...value, version: 1 } satisfies StoredReadAuth)
  );
}

function currentSessionAddress(): string | null {
  return currentCachedReadAuth()?.address ?? pendingReadAuth?.address ?? null;
}

export function getCachedReadAuthHeaders(): Record<string, string> {
  return currentCachedReadAuth()?.headers ?? {};
}

export function getCachedReadAuthAddress(): string | null {
  return currentCachedReadAuth()?.address ?? null;
}

export function setCachedReadAuthHeaders(address: string, headers: Record<string, string>): void {
  sessionGeneration += 1;
  pendingReadAuth = null;
  cachedReadAuth = { address: address.toLowerCase(), headers };
  persistReadAuth(cachedReadAuth);
}

/**
 * Whether a signed proof for this wallet is already held.
 *
 * The read-auth message is `taskmarket:read:<address>` and carries no nonce, so a signature
 * does not expire and is not bound to one request. That makes the cache reusable for the whole
 * session: a second consumer mounting later should read what the first one signed rather than
 * putting a wallet prompt in front of the user again. Consumers ask before signing.
 */
export function hasCachedReadAuthHeaders(address: string): boolean {
  return currentCachedReadAuth()?.address === address.toLowerCase();
}

export function clearCachedReadAuthHeaders(): void {
  sessionGeneration += 1;
  pendingReadAuth = null;
  cachedReadAuth = null;
  removeSessionStorageItem(READ_AUTH_SESSION_KEY);
}

export function updateReadAuthConsumerAddress(consumer: object, address: string | undefined): void {
  const previousAddress = consumerAddresses.get(consumer) ?? null;
  const normalizedAddress = address?.toLowerCase() ?? null;
  consumerAddresses.set(consumer, normalizedAddress);

  const sessionAddress = currentSessionAddress();
  if (normalizedAddress && sessionAddress && sessionAddress !== normalizedAddress) {
    clearCachedReadAuthHeaders();
    return;
  }

  if (
    previousAddress &&
    !normalizedAddress &&
    sessionAddress === previousAddress &&
    ![...consumerAddresses.values()].some((candidate) => candidate === previousAddress)
  ) {
    clearCachedReadAuthHeaders();
  }
}

export function removeReadAuthConsumer(consumer: object): void {
  consumerAddresses.delete(consumer);
}

export function getOrCreateCachedReadAuthHeaders(
  address: string,
  createHeaders: () => Promise<Record<string, string>>
): Promise<Record<string, string>> {
  const normalizedAddress = address.toLowerCase();
  const current = currentCachedReadAuth();
  if (current?.address === normalizedAddress) {
    return Promise.resolve(current.headers);
  }
  if (pendingReadAuth?.address === normalizedAddress) {
    return pendingReadAuth.promise;
  }

  sessionGeneration += 1;
  const requestGeneration = sessionGeneration;
  cachedReadAuth = null;
  removeSessionStorageItem(READ_AUTH_SESSION_KEY);

  const promise = createHeaders()
    .then((headers) => {
      if (sessionGeneration === requestGeneration && pendingReadAuth?.promise === promise) {
        cachedReadAuth = { address: normalizedAddress, headers };
        persistReadAuth(cachedReadAuth);
      }
      return headers;
    })
    .finally(() => {
      if (pendingReadAuth?.promise === promise) {
        pendingReadAuth = null;
      }
    });
  pendingReadAuth = { address: normalizedAddress, promise };
  return promise;
}
