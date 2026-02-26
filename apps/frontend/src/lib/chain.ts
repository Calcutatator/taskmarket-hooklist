export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 8453);
export const EXPLORER_URL =
  (import.meta.env.VITE_EXPLORER_URL as string | undefined) ?? 'https://basescan.org';
export const IDENTITY_REGISTRY = (import.meta.env.VITE_IDENTITY_REGISTRY ??
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432') as `0x${string}`;
export const NETWORK_NAME = CHAIN_ID === 84532 ? 'base-sepolia' : 'base';
