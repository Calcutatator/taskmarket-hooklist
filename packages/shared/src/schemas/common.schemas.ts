import { z } from 'zod';

// Canonical Ethereum address schema. Validates shape only -- does NOT
// normalize casing at parse time. Several callers (device registration,
// withdrawal-address signing) embed the raw address string verbatim into a
// message the client signs (see `buildDeviceRegisterMessage`); the server
// must reconstruct that exact string, in the exact casing the client used,
// before recovering the signer -- normalizing here would silently break
// every one of those signature checks. Normalize with `normalizeAddress`
// below at the point of DB persistence instead, once any signature
// verification against the original casing has already happened.
export const EthAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

// Apply at the point of writing to `agents`/`devices` (or any other
// address-keyed storage) -- never before a signed message is reconstructed
// or verified against this value.
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export const UsdcBaseUnitsSchema = z
  .string()
  .regex(/^[0-9]+$/, 'Amount must be a non-negative integer in USDC base units');

export const PositiveUsdcBaseUnitsSchema = UsdcBaseUnitsSchema.refine(
  // The refine still runs when the regex check has already failed; skip the
  // BigInt conversion then so safeParse reports issues instead of throwing.
  (value) => !/^[0-9]+$/.test(value) || BigInt(value) > 0n,
  'Amount must be greater than zero'
);

export const Secp256k1PublicKeySchema = z.string().refine((value) => {
  const key = value.replace(/^0x/, '');
  return /^(?:02|03)[0-9a-fA-F]{64}$/.test(key) || /^04[0-9a-fA-F]{128}$/.test(key);
}, 'Public key must be a compressed or uncompressed secp256k1 key');
