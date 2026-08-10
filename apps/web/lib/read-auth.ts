// Module-level cache for the general read-auth headers (ADR-0016/ADR-0022):
// at most one signed proof is held at a time, for whichever wallet is
// currently connected. `makeTrpcClient` (api/client.tsx) reads this on every
// request so any endpoint that cares about ctx.caller picks it up, without
// each query needing to thread headers through itself.

let cachedReadAuth: { address: string; headers: Record<string, string> } | null = null;

export function getCachedReadAuthHeaders(): Record<string, string> {
  return cachedReadAuth?.headers ?? {};
}

export function setCachedReadAuthHeaders(address: string, headers: Record<string, string>): void {
  cachedReadAuth = { address: address.toLowerCase(), headers };
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
  return cachedReadAuth?.address === address.toLowerCase();
}

export function clearCachedReadAuthHeaders(): void {
  cachedReadAuth = null;
}
