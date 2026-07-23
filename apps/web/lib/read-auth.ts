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

export function clearCachedReadAuthHeaders(): void {
  cachedReadAuth = null;
}
