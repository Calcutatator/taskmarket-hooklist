// Implements: ADR-0045, ADR-0048
import { TRPCError } from '@trpc/server';

import type { db as DbType } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { ServerTransactionPendingError } from '../lib/server-transaction-dispatcher';
import { registerRelayedIntentHandlers } from './intents/register';
import { withRelayEnvelope } from './relay-envelope';
import { completeRelayedIntent } from './relayed-intent-registry';
import {
  linkIntentToBroadcast,
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
   * Non-monetary cleanup for a call that never reached the chain -- releasing a reservation,
   * say. Never a refund: whether a payment is orphaned is settlement's decision alone
   * (ADR-0048), made from a confirmed on-chain verdict this code has not seen.
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
      await linkIntentToBroadcast({ db: input.db, intentId: intent.id, txHash: error.hash });
      throw error;
    }

    // Nothing reached the chain, so the intent stays in 'recorded' rather than being marked
    // failed here: only confirmed on-chain evidence writes a terminal state (ADR-0045).
    if (input.onNotBroadcast) await input.onNotBroadcast();
    throw error;
  }

  await linkIntentToBroadcast({ db: input.db, intentId: intent.id, txHash });

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
