// Compute a block explorer URL for a tx hash based on the configured chain.

const EXPLORER_BY_CHAIN: Record<number, string> = {
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
};

function chainIdFromEnv(): number | null {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function explorerTxUrl(txHash: string): string | null {
  const explicit = process.env.NEXT_PUBLIC_EXPLORER_URL;
  if (explicit) return `${explicit.replace(/\/$/, '')}/tx/${txHash}`;
  const id = chainIdFromEnv();
  const base = id !== null ? EXPLORER_BY_CHAIN[id] : null;
  return base ? `${base}/tx/${txHash}` : null;
}
