import { sql } from 'drizzle-orm';
import { recoverMessageAddress } from 'viem';
import { agents } from '../db/schema';

/**
 * Case-insensitive equality for agents.address. Addresses arrive from many sources
 * (X402 payer context, on-chain event data, user input) with inconsistent casing --
 * identity registration always lowercases before writing (see identity.router.ts),
 * but not every caller does, so lowering both sides here is the only match that's
 * safe regardless of what's actually stored or what casing the caller passed in.
 */
export function lowerAddressEq(address: string) {
  return sql`lower(${agents.address}) = lower(${address})`;
}

export type SignedAddressVerification =
  | { verified: true }
  | { verified: false; reason: 'invalid_signature' | 'address_mismatch' };

/**
 * Recovers the signer of `message` from `signature` and checks it matches
 * `expectedAddress` (case-insensitively). Never throws -- returns a
 * discriminated result instead of a bare boolean so callers can keep
 * throwing their own distinct error code/message per failure reason (several
 * endpoints distinguish "signature didn't parse" from "signature is from the
 * wrong address" -- e.g. submissions.submit's BAD_REQUEST 'Invalid
 * signature' vs. UNAUTHORIZED 'Signature does not match worker address').
 * Callers that never made that distinction (wallet.setWithdrawalAddress,
 * agents.inbox) can just check `.verified` and ignore `.reason`.
 */
export async function verifySignedAddress(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<SignedAddressVerification> {
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
  } catch {
    return { verified: false, reason: 'invalid_signature' };
  }
  return signer.toLowerCase() === expectedAddress.toLowerCase()
    ? { verified: true }
    : { verified: false, reason: 'address_mismatch' };
}
