// Implements: ADR-0045, ADR-0048, ADR-0052
// Implements: ADR-0049
import type { ApiErrorEnvelope } from '@taskmarket/shared';

import type { db as DbType } from '../db/client';
import type { RelayedIntent } from '../db/schema';
import { apiError } from '../lib/api-error';
import { ServerTransactionPendingError } from '../lib/server-transaction-dispatcher';
import { registerRelayedIntentHandlers } from './intents/register';
import { withRelayEnvelope } from './relay-envelope';
import { completeRelayedIntent } from './relayed-intent-registry';
import {
  claimIntentForBroadcast,
  getRelayedIntent,
  type IntentPaymentReference,
  persistIntentBroadcast,
  recordRelayedIntent,
  relayEnvelopeForIntent,
  type RelayedIntentOperation,
} from './relayed-intents';

type Db = typeof DbType;

export type RelayedIntentRequestInput = {
  db: Db;
  /**
   * The caller's own key for this logical operation, from `ctx.idempotencyKey` (ADR-0052).
   *
   * Required in the type and validated at runtime, so a router cannot forget to plumb it and
   * a caller cannot omit it. Deliberately not defaulted to anything: a key the backend
   * invented would be a fresh value on every retry, which is the absence of idempotency
   * dressed as its presence.
   */
  idempotencyKey: string | undefined;
  operation: RelayedIntentOperation;
  /**
   * Who the relay acted for. Recorded for provenance on every path, paid or not; it is the
   * presence of `payment`, not this, that makes an intent refundable.
   * A free relayed write (claiming a task, submitting work, finalizing a verdict) still needs
   * an intent so its post-receipt database work survives the request, and there is simply
   * nothing to refund when it fails.
   */
  payer?: string;
  /**
   * The settled payment this intent is answerable for, from `settledPaymentReference`.
   *
   * Whole or absent, never partial. Three optional fields let a paid path record a hash with
   * no amount, which reads as a covered payment everywhere except the one place it matters:
   * `settleAbandonedIntents` cannot transfer an amount it does not know, so it skipped the
   * row, and the payer was neither served nor refunded. One object removes the shape that
   * mistake needs (ADR-0048, ADR-0050).
   */
  payment?: IntentPaymentReference;
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
 *     settle it, and the caller is answered with the `intent_in_flight` envelope carrying the
 *     intent id and status. Nothing here concludes failure.
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
    idempotencyKey: input.idempotencyKey,
    operation: input.operation,
    payer: input.payer,
    payment: input.payment,
    payload: input.payload,
  });

  // The row that came back may not be new. `recordRelayedIntent` is keyed on the caller's
  // idempotency key, so a retry of the same operation gets the *original* intent back --
  // which may already have a transaction on chain or be finished. That reuse is the point,
  // and sending regardless would undo it: one operation, two chain calls (ADR-0045).
  if (intent.status === 'completed' && intent.txHash) {
    return { intent, txHash: intent.txHash as `0x${string}` };
  }

  // Reading the status is not enough, and this is the defect the claim closes. Two concurrent
  // requests carrying the same key both resolve to one `recorded` intent, both find it
  // unsent, and both call `send()`. A unique index stops a second *row*; nothing stops a
  // second *transaction* against one row. So the right to send is taken the same way
  // `claimIntentForCompletion` takes the right to complete: one conditional UPDATE, which
  // exactly one caller's predicate matches.
  //
  // The loser is told the operation is in flight rather than made to wait for the winner's
  // result. Waiting would mean holding a connection for an outcome that may take the whole
  // receipt window to arrive, to deliver an answer the caller can already get -- they hold
  // the intent id and the key, and ADR-0049's status surface answers on both. A duplicate
  // submission's correct answer is "this is already happening, here is the handle", not a
  // second copy of the work or a blocked socket.
  const claimed = await claimIntentForBroadcast({
    db: input.db,
    expectedAttempts: intent.broadcastAttempts,
    intentId: intent.id,
  });
  if (!claimed) {
    const current = (await getRelayedIntent({ db: input.db, intentId: intent.id })) ?? intent;
    throw apiError({
      reason: 'idempotency_key_reused',
      intentId: current.id,
      intentStatus: current.status as ApiErrorEnvelope['intentStatus'],
      operation: current.operation,
      idempotencyKey: current.idempotencyKey,
      txHash: current.txHash ?? undefined,
      message:
        `${input.operation} for this idempotency key is already ${current.status} and is not ` +
        `submitted again (intent ${current.id}). Poll intents.get for its outcome.`,
    });
  }

  let txHash: `0x${string}`;
  try {
    // Bound so the first attempt uses the same envelope every later rebroadcast will use.
    // Without this the original send would carry one deadline and every retry another, and
    // the stored one would only ever apply to attempts this process did not make.
    txHash = await withRelayEnvelope(relayEnvelopeForIntent(claimed), () => input.send());
  } catch (error) {
    // Live, not failed. Link it so the reconciler owns the outcome and let the caller see the
    // pending error as-is; the intent stays non-terminal until the chain says otherwise.
    if (error instanceof ServerTransactionPendingError) {
      await persistIntentBroadcast({ db: input.db, intentId: claimed.id, txHash: error.hash });
      // Translated rather than rethrown. Rethrowing raw is what made this a 500 whose prose was
      // the only evidence the write was alive -- the state ADR-0049 point 3 exists to end. The
      // envelope says the same thing structurally: still landing, here is the handle, and no
      // claim either way about whether the payment moved.
      throw apiError({
        reason: 'intent_in_flight',
        intentId: claimed.id,
        // 'broadcast' is what `persistIntentBroadcast` just wrote, and it is reported from the
        // constant rather than re-read: the row is what it is, and a second query here would
        // only widen the window in which the reconciler could move it underneath us.
        intentStatus: 'broadcast',
        operation: claimed.operation,
        idempotencyKey: claimed.idempotencyKey,
        txHash: error.hash,
        message: error.message,
      });
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
  await persistIntentBroadcast({ db: input.db, intentId: claimed.id, txHash });

  const completed = await completeRelayedIntent({ db: input.db, intent: claimed, txHash });
  if (!completed) {
    // The transaction is on chain and the work happened, so there is nothing to refund. The
    // intent stays claimable for the reconciler; the caller is told the chain part succeeded.
    throw apiError({
      reason: 'intent_completion_deferred',
      intentId: claimed.id,
      intentStatus: 'broadcast',
      operation: claimed.operation,
      idempotencyKey: claimed.idempotencyKey,
      txHash,
      message:
        input.describeCompletionFailure?.(claimed.id) ??
        `${input.operation} was confirmed on chain but recording it did not complete; it will be retried automatically (intent ${claimed.id}).`,
    });
  }

  return { intent: claimed, txHash };
}
