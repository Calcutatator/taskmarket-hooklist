// Implements: ADR-0045, ADR-0048
import { TRPCError } from '@trpc/server';

import type { db as DbType } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { ServerTransactionPendingError } from '../lib/server-transaction-dispatcher';
import { registerRelayedIntentHandlers } from './intents/register';
import { withRelayEnvelope } from './relay-envelope';
import { completeRelayedIntent } from './relayed-intent-registry';
import {
  persistIntentBroadcast,
  recordRelayedIntent,
  relayEnvelopeForIntent,
  type RelayedIntentOperation,
} from './relayed-intents';

type Db = typeof DbType;

export type RelayedIntentRequestInput = {
  db: Db;
  operation: RelayedIntentOperation;
  /**
   * Who the relay acted for. Recorded for provenance on every path, paid or not; it is the
   * presence of `paymentTxHash` and `paymentAmount`, not this, that makes an intent refundable.
   * A free relayed write (claiming a task, submitting work, finalizing a verdict) still needs
   * an intent so its post-receipt database work survives the request, and there is simply
   * nothing to refund when it fails.
   */
  payer?: string;
  /**
   * What the payer was charged, in USDC base units. Every paid mutation except tasks.create
   * and tasks.update charges the flat action fee, so callers of those two pass their own.
   */
  paymentAmount?: bigint;
  paymentTxHash?: `0x${string}`;
  payload: unknown;
  /** Broadcasts the one contract call this intent stands for. */
  send: () => Promise<`0x${string}`>;
  /**
   * Best-effort cleanup of something whose loss costs nothing, for a send that threw.
   *
   * **The name overstates what this knows, and the overstatement is the trap.** "Not
   * broadcast" is not something a thrown error establishes. `already known` and
   * `already imported` mean the transaction *is* in a mempool and can still mine; a connection
   * reset mid-send means the node may have taken it and we never heard the answer. All of them
   * arrive here indistinguishable from a request that was rejected outright.
   *
   * So nothing security-relevant or monetary may hang off this, and neither may anything whose
   * correctness depends on the call genuinely not having landed:
   *
   *   - **No refunds.** Whether a payment is orphaned is settlement's decision alone
   *     (ADR-0048), made from a confirmed on-chain verdict this code has not seen.
   *   - **No releasing guard state** -- a replay nonce, a claim, anything whose whole job is
   *     to stop a second attempt. Releasing one here reopens the window it exists to close
   *     while the first transaction may still be live. Register a `releaseGuard` on the
   *     operation instead; settlement runs it on confirmed failure or exhausted retry
   *     (ADR-0050).
   *
   * What is left is cleanup that is merely tidy: `tasks.create`'s task-drop reservation, which
   * costs nothing if it is released in error and expires on its own if it is never released at
   * all. If losing the race in either direction would be harmless, it belongs here. If it
   * would not, it does not.
   */
  onNotBroadcast?: () => Promise<void>;
  /** How to describe the operation in the error a failed completion raises. */
  describeCompletionFailure?: (intentId: string) => string;
};

/**
 * Record a durable intent, broadcast its one contract call, complete it through the registry.
 *
 * The shape every relayed write shares -- paid or free -- factored out of the routers so the
 * ordering rules that make it correct are stated once. An intent does two jobs, and only the
 * first is about money: it makes a payment refundable on a confirmed failure, and it makes the
 * post-receipt database work outlive the request. The second applies to every relayed write,
 * so a free one is wired the same way, minus the payment reference.
 *
 * The rules:
 *
 *   - The intent row exists before the chain call, so no transaction is ever live without a
 *     durable record of what it was for, and no payment is consumed without one either.
 *   - A pending outcome is in flight, not failed: the hash is linked so the reconciler can
 *     settle it, and the error propagates unchanged. Nothing here concludes failure.
 *   - Post-receipt work runs through completeRelayedIntent, never by calling the handler
 *     directly, so a reconciler pass observing the same receipt cannot run it twice.
 *   - There is no catch that compensates. A confirmed-failed intent is refunded by
 *     relayed-intent-settlement.ts and nowhere else (ADR-0048).
 */
export async function runRelayedIntent(
  input: RelayedIntentRequestInput
): Promise<{ intent: RelayedIntent; txHash: `0x${string}` }> {
  // Registration is idempotent, and asking for it here rather than relying on each router to
  // remember is what makes a missing handler impossible: no relayed path reaches the chain
  // without going through this function first.
  registerRelayedIntentHandlers();

  const intent = await recordRelayedIntent({
    db: input.db,
    operation: input.operation,
    payer: input.payer,
    paymentAmount: input.paymentAmount,
    paymentTxHash: input.paymentTxHash,
    payload: input.payload,
  });

  // The row that came back may not be new. `recordRelayedIntent` is keyed on the payment hash,
  // so a retried request carrying an x402 payment that has already been settled once gets the
  // *original* intent back -- which may already have a transaction on chain or be finished. The
  // reuse is what makes the payment idempotent, and sending regardless would undo it: one
  // payment, two chain calls (ADR-0045). So what the caller gets depends on where that intent
  // already is, and only a genuinely fresh one is sent.
  if (intent.status === 'completed' && intent.txHash) {
    return { intent, txHash: intent.txHash as `0x${string}` };
  }
  if (intent.status !== 'recorded' || intent.txHash) {
    // In flight, or terminally failed. Either way the payment has been spent on an attempt that
    // exists, and the outcome belongs to the reconciler and to settlement, not to a second send.
    throw new TRPCError({
      code: 'CONFLICT',
      message: `${input.operation} for this payment is already ${intent.status} and cannot be submitted again (intent ${intent.id}).`,
    });
  }

  let txHash: `0x${string}`;
  try {
    // Bound so the first attempt uses the same envelope every later rebroadcast will use.
    // Without this the original send would carry one deadline and every retry another, and
    // the stored one would only ever apply to attempts this process did not make.
    txHash = await withRelayEnvelope(relayEnvelopeForIntent(intent), () => input.send());
  } catch (error) {
    // Live, not failed. Link it so the reconciler owns the outcome and let the caller see the
    // pending error as-is; the intent stays non-terminal until the chain says otherwise.
    if (error instanceof ServerTransactionPendingError) {
      await persistIntentBroadcast({ db: input.db, intentId: intent.id, txHash: error.hash });
      throw error;
    }

    // The intent stays in 'recorded' rather than being marked failed here: only confirmed
    // on-chain evidence writes a terminal state (ADR-0045). Note what this branch does *not*
    // know -- whether anything reached the chain. The error may well be `already known`. Only
    // harmless cleanup may run from here; see the field's own doc.
    if (input.onNotBroadcast) await input.onNotBroadcast();
    throw error;
  }

  // The send returned a hash, so the transaction is live. Recording it is what keeps the
  // rebroadcast sweep from reading this intent as one that never reached the chain and sending
  // it a second time, so it happens before anything else that could fail and it never throws.
  await persistIntentBroadcast({ db: input.db, intentId: intent.id, txHash });

  const completed = await completeRelayedIntent({ db: input.db, intent, txHash });
  if (!completed) {
    // The transaction is on chain and the work happened, so there is nothing to refund. The
    // intent stays claimable for the reconciler; the caller is told the chain part succeeded.
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message:
        input.describeCompletionFailure?.(intent.id) ??
        `${input.operation} was confirmed on chain but recording it did not complete; it will be retried automatically (intent ${intent.id}).`,
    });
  }

  return { intent, txHash };
}
