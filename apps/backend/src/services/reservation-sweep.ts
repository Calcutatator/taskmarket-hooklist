// Implements: ADR-0067
import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import { getPublicClient } from '../lib/rpc-gateway';
import {
  deleteReservation,
  holdReservationForReview,
  listExpiredReservations,
} from './relayed-intents';

/**
 * The one question the sweep is allowed to ask about a reservation's authorization.
 *
 * EIP-3009 requires the token to record every consumed authorization under
 * `(authorizer, nonce)`, and USDC exposes it. That makes "did this specific authorization
 * settle" a lookup rather than a search -- which is the property ADR-0067 says turns expiry
 * from a risk into a safe operation. Searching by payer and amount instead would find *a*
 * payment and have no way to tell whether it was this one.
 */
const AUTHORIZATION_STATE_ABI = [
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

async function authorizationWasConsumed(payer: string, nonce: string): Promise<boolean> {
  return (await getPublicClient().readContract({
    abi: AUTHORIZATION_STATE_ABI,
    address: getServerConfig().USDC_TOKEN_ADDRESS as `0x${string}`,
    args: [payer as `0x${string}`, nonce as `0x${string}`],
    functionName: 'authorizationState',
  })) as boolean;
}

/**
 * What to do with one reservation whose TTL has run out.
 *
 * Split out from the loop because the whole decision is here and it is short enough to read in
 * one go, which is the point: the rule ADR-0067 states is a rule about *this* function.
 *
 * **A reservation is never expired without first establishing that no payment landed against
 * it.** Time alone is not evidence. Two abandonments look identical afterwards -- the caller
 * took its 402 and walked away, or the caller paid and this process died between settlement and
 * attachment -- and only the first is garbage. Expiring the second discards a settled payment
 * and leaves a payer out of pocket with nothing recording why.
 */
async function resolveExpiredReservation(intent: RelayedIntent): Promise<void> {
  // No authorization was ever recorded, so nothing was ever asked of the facilitator on this
  // reservation's behalf. The write-ahead record is what makes that a fact rather than an
  // inference: it is written before the settle call, so its absence means the call was not
  // made (ADR-0067).
  if (!intent.paymentAuthNonce || !intent.paymentAuthPayer) {
    await deleteReservation({ db, intentId: intent.id });
    return;
  }

  let consumed: boolean;
  try {
    consumed = await authorizationWasConsumed(intent.paymentAuthPayer, intent.paymentAuthNonce);
  } catch (error) {
    // Unanswered is not "no". Leaving the row for the next pass costs a held idempotency key
    // for a few minutes; deleting it on an RPC failure could discard a settled payment, which
    // costs the payer their money.
    logger.error(
      'Could not establish whether a reservation was paid; leaving it for a later pass',
      {
        error: error instanceof Error ? error.message : String(error),
        intentId: intent.id,
      }
    );
    return;
  }

  if (!consumed) {
    // The token contract says this authorization was never used, so no money moved for it. That
    // is positive evidence, not an absence, and it is the only basis on which this row is
    // dropped.
    await deleteReservation({ db, intentId: intent.id });
    return;
  }

  // Money moved and nothing attached it. This is the case time alone could never have told
  // apart, and it is deliberately not resolved automatically: there is no settlement
  // transaction hash on this row -- the settle call never returned one to us -- so the
  // orphaned-payment ledger, which keys on that hash, has nothing to record. Keeping the row is
  // what preserves the only durable answer to "what was this payment for" (ADR-0048, ADR-0067).
  const reason = `Payment authorization ${intent.paymentAuthNonce} for payer ${intent.paymentAuthPayer} was consumed on chain but never attached to this reservation; it needs manual reconciliation`;
  await holdReservationForReview({ db, intentId: intent.id, reason });
  logger.error('Expired reservation has a settled payment behind it; not expiring it', {
    amount: intent.paymentAuthAmount,
    intentId: intent.id,
    nonce: intent.paymentAuthNonce,
    payer: intent.paymentAuthPayer,
  });
}

/**
 * Retire reservations nobody filled.
 *
 * The TTL is load-bearing rather than housekeeping. The reservation is written before any
 * caller is authenticated -- the pre-402 path has no payment payload and therefore no payer --
 * so an unauthenticated client can create rows here, and without this sweep the table would
 * grow for as long as it kept sending fresh UUIDs. What bounds the damage is the pair: ingress
 * rate limiting caps the rate, and the TTL caps how long each row survives, so the steady-state
 * row count is the product of the two rather than unbounded. Neither half works alone, and
 * loosening either one loosens this.
 */
export async function expireStaleReservations(limit: number): Promise<void> {
  for (const intent of await listExpiredReservations({ db, limit })) {
    try {
      await resolveExpiredReservation(intent);
    } catch (error) {
      // One reservation must not end the pass; the next one sees it again.
      logger.error('Expiring a reservation failed', {
        error: error instanceof Error ? error.message : String(error),
        intentId: intent.id,
      });
    }
  }
}
