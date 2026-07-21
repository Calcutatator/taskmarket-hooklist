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
 * Callers that never made that distinction (agents.inbox, which has no error
 * path at all -- an invalid signature just falls back to the public view)
 * can just check `.verified` and ignore `.reason`.
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

type SignedAddressFailureReason = Extract<SignedAddressVerification, { verified: false }>['reason'];

/**
 * `verifySignedAddress`, but throws the caller's own error per failure reason
 * instead of returning a result to branch on. `onFailure` is a `Record`
 * keyed by every literal in `SignedAddressFailureReason`, not a switch/ternary
 * -- if a third reason is ever added to `SignedAddressVerification`, every
 * call site's object literal fails to compile until it adds that key, so a
 * new reason can't silently fall through to the wrong branch the way a
 * ternary would.
 */
export async function verifySignedAddressOrThrow(
  message: string,
  signature: string,
  expectedAddress: string,
  onFailure: Record<SignedAddressFailureReason, () => Error>
): Promise<void> {
  const result = await verifySignedAddress(message, signature, expectedAddress);
  if (!result.verified) {
    throw onFailure[result.reason]();
  }
}
