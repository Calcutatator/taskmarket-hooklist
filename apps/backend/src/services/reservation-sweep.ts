// Implements: ADR-0067
import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { logger } from '../lib/logger';
import { getPublicClient } from '../lib/rpc-gateway';
import {
  deleteReservation,
  holdReservationForReview,
  isEncodableAuthorizationPair,
  listExpiredReservations,
  retireUnpaidReservation,
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

  // A pair that could never name a real authorization is not an unanswered question -- it is an
  // answered one. `authorizationState` takes an `(address, bytes32)`, so a value outside those
  // shapes cannot be encoded, let alone consumed, and no settlement can ever attach to it.
  //
  // That distinction is load-bearing rather than tidy. These columns are written from an
  // attacker-supplied header before the facilitator verifies anything, and until they were
  // validated at the write a malformed value threw inside the read below and landed in the
  // `catch`, which leaves the row untouched for "a later pass". Every later pass repeated it,
  // so a handful of poisoned rows held the sweep's whole window and the safety net below --
  // the one that surfaces a payment that settled but never attached -- never ran again.
  //
  // The write now rejects these, so this branch is for rows already stored before that. It
  // retires rather than deletes, which is what the `!consumed` branch does with the same
  // reasoning: terminal, out of the window, and still on record.
  if (!isEncodableAuthorizationPair(intent.paymentAuthPayer, intent.paymentAuthNonce)) {
    logger.error('Reservation carries an unencodable payment authorization; retiring it', {
      intentId: intent.id,
    });
    await retireUnpaidReservation({
      db,
      intentId: intent.id,
      reason:
        'The recorded payment authorization is not a valid (payer, nonce) pair, so no settlement could ever have been made against it',
    });
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
    // The token contract says this authorization has not been used *yet*, and "yet" is the word
    // the old code dropped. `authorizationState` flips when the settlement mines, not when the
    // facilitator broadcasts it, so a `false` covers both "never submitted" and "in the
    // mempool" -- and only the first is garbage. Deleting on the second discards the write-ahead
    // record for a payment that lands a block later, which is the exact loss ADR-0067 was
    // written to prevent, and the same reasoning the RPC-failure branch above already applies.
    //
    // So the row is retired rather than deleted: terminal, no longer swept, and still carrying
    // the (payer, nonce) pair that keeps a late-mining authorization attributable (ADR-0069).
    await retireUnpaidReservation({
      db,
      intentId: intent.id,
      reason: `Payment authorization ${intent.paymentAuthNonce} for payer ${intent.paymentAuthPayer} was still unused when this reservation expired; retained so a late settlement stays attributable`,
    });
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
 * Since the claim moved onto the round that carries the payment (ADR-0068), a reservation is
 * only ever written by a request holding a signed authorization, and that request either fills
 * it or releases it. So what reaches this sweep is the narrow case the write-ahead
 * authorization record exists for: a process that died between claiming the key and hearing
 * back from the facilitator. Those rows must still not be deleted on age alone -- the money may
 * have moved -- which is why expiry asks the token contract about the recorded (payer, nonce)
 * pair rather than inferring from the absence of a payment reference.
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
