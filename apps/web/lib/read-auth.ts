// Module-level cache for the general read-auth headers (ADR-0016/ADR-0023):
// at most one signed proof is held at a time, for whichever wallet is
// currently connected. `makeTrpcClient` (api/client.tsx) reads this on every
// request so any endpoint that cares about ctx.caller picks it up, without
// each query needing to thread headers through itself.

let cachedReadAuth: { address: string; headers: Record<string, string> } | null = null;
let pendingReadAuth: {
  address: string;
  promise: Promise<Record<string, string>>;
} | null = null;
let sessionGeneration = 0;
const consumerAddresses = new Map<object, string | null>();

function currentSessionAddress(): string | null {
  return cachedReadAuth?.address ?? pendingReadAuth?.address ?? null;
}

export function getCachedReadAuthHeaders(): Record<string, string> {
  return cachedReadAuth?.headers ?? {};
}

export function getCachedReadAuthAddress(): string | null {
  return cachedReadAuth?.address ?? null;
}

export function setCachedReadAuthHeaders(address: string, headers: Record<string, string>): void {
  sessionGeneration += 1;
  pendingReadAuth = null;
  cachedReadAuth = { address: address.toLowerCase(), headers };
}

export function clearCachedReadAuthHeaders(): void {
  sessionGeneration += 1;
  pendingReadAuth = null;
  cachedReadAuth = null;
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
  if (cachedReadAuth?.address === normalizedAddress) {
    return Promise.resolve(cachedReadAuth.headers);
  }
  if (pendingReadAuth?.address === normalizedAddress) {
    return pendingReadAuth.promise;
  }

  sessionGeneration += 1;
  const requestGeneration = sessionGeneration;
  cachedReadAuth = null;

  const promise = createHeaders()
    .then((headers) => {
      if (sessionGeneration === requestGeneration && pendingReadAuth?.promise === promise) {
        cachedReadAuth = { address: normalizedAddress, headers };
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
