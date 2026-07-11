import { z } from 'zod';

export const UsdcBaseUnitsSchema = z
  .string()
  .regex(/^[0-9]+$/, 'Amount must be a non-negative integer in USDC base units');

export const PositiveUsdcBaseUnitsSchema = UsdcBaseUnitsSchema.refine(
  (value) => BigInt(value) > 0n,
  'Amount must be greater than zero'
);

export const Secp256k1PublicKeySchema = z.string().refine((value) => {
  const key = value.replace(/^0x/, '');
  return /^(?:02|03)[0-9a-fA-F]{64}$/.test(key) || /^04[0-9a-fA-F]{128}$/.test(key);
}, 'Public key must be a compressed or uncompressed secp256k1 key');
