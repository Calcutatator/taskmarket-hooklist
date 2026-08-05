// Implements: ADR-0045, ADR-0050, ADR-0053
import type { Hex } from 'viem';

import { db } from '../db/client';
import type { RelayedIntentSettlement } from '../lib/server-transaction-reconciler';
import { logger } from '../lib/logger';
import { handlePostPaymentFailure } from './orphaned-payments';
import { completeRelayedIntent, releaseIntentGuard } from './relayed-intent-registry';
import {
  findIntentByTransactionId,
  listAbandonedIntents,
  listConfirmedUnsettledIntents,
  markIntentFailed,
} from './relayed-intents';

/**
 * Joins the reconciler's on-chain verdict to the intent layer.
 *
 * This is where ADR-0045's central rule is enforced in practice: a refund is issued here and
 * only here, reached only from `onFailed`, which the reconciler calls only on a reverted
 * receipt or a mined replacement. There is deliberately no path from a timeout to this code.
 */
/**
 * How long a payment-carrying intent must sit in `recorded` before it is written off.
 *
 * Generous on purpose. The only way to reach this state is for the process to die between
 * persisting the intent and broadcasting, or for the broadcast to be rejected outright before
 * a nonce was ever spent -- in both cases nothing is on chain and nothing ever will be. The
 * window exists solely so a request still executing its own chain call cannot be overtaken.
 */
export const ABANDONED_INTENT_CUTOFF_MS = 15 * 60 * 1000;

/**
 * Write off intents that never reached the chain and will not be tried again.
 *
 * The last resort, deliberately. A payer who paid for a task would rather have the task, so an
 * intent that never broadcast is rebroadcast by the worker first; only once its retry budget
 * is spent -- which `listAbandonedIntents` is what checks -- does it arrive here to be written
 * off. Refund is the fallback, not the reflex.
 *
 * The reconciler settles transactions, so it can only speak for intents that have one. An
 * intent that reaches this point has none and never will: there is no verdict coming, and
 * without this the payer would simply never be repaid. It is still the same rule ADR-0045
 * states and ADR-0048 places here -- a refund is issued only when the system knows the work
 * did not happen, and "no nonce was ever allocated for it" is knowing that, not guessing it.
 *
 * Scoped to intents with no linked outbox row and no hash, so an intent whose transaction is
 * live but whose linking write was lost is never mistaken for one that never started.
 *
 * Two things happen here, and only one of them is about money. Every exhausted intent reaches
 * `failed` and hands back whatever guard state it claimed, paid or not (ADR-0050): exhaustion
 * is the point at which we stop asking, so the reservation it was holding is no longer
 * reserving an attempt anyone will make. Refund applies only to the ones carrying a payment.
 */
export async function settleAbandonedIntents(limit: number): Promise<void> {
  const cutoff = new Date(Date.now() - ABANDONED_INTENT_CUTOFF_MS);
  for (const intent of await listAbandonedIntents({ cutoff, db, limit })) {
    if (intent.serverWalletTransactionId || intent.txHash) continue;

    // Which bound ended it is worth saying, because the two mean different things to whoever
    // reads it back: an expired receipt is the payer's own deadline arriving, and resubmitting
    // with a fresh signature will work. A spent attempt budget is ours, and resubmitting may
    // hit whatever was failing.
    const deadline = intent.relayValidBefore ? BigInt(intent.relayValidBefore) : null;
    const expired = deadline !== null && deadline < BigInt(Math.floor(Date.now() / 1000));

    await markIntentFailed({
      db,
      intentId: intent.id,
      reason: expired
        ? 'Intent was never broadcast and its relay receipt has expired; resubmit with a fresh signature'
        : 'Intent was never broadcast; no transaction was ever sent for it',
    });

    // Safe here for the same reason the refund below is: `listAbandonedIntents` requires a
    // spent retry budget, and the two conditions above require positive evidence that no nonce
    // was ever allocated. Nothing is live, so nothing can land later against a released guard.
    await releaseIntentGuard({ db, intent });

    // `payer` alone does not mean paid: every intent records one for provenance, free or not.
    // A payment hash or an amount is what says money moved for this intent.
    //
    // `payment_required` is consulted first because the absence of those two no longer has one
    // meaning (ADR-0067). A free relayed write has nothing to refund and is correct here; an
    // intent whose route *did* require payment and still has no reference is not correct at
    // all -- it is a reservation that reached `recorded` without its payment being attached,
    // which the fill makes impossible in one statement and which is therefore a defect if it
    // ever appears. Skipping it silently as though it were free is exactly how a pending
    // payment goes unreconciled, so it is reported.
    if (!intent.paymentTxHash && !intent.paymentAmount) {
      if (intent.paymentRequired) {
        logger.error('Abandoned intent required payment but carries no payment reference', {
          intentId: intent.id,
          operation: intent.operation,
        });
      }
      continue;
    }

    // A row carrying part of a payment reference is a bug, not a state to move past. It was
    // reachable while the reference lived in three independently optional fields: a paid path
    // that recorded a hash and no amount produced a row that looks paid-for to anyone reading
    // it, and that this sweep silently skipped -- so the payer was neither served nor
    // refunded, and nothing said so. `IntentPaymentReference` makes that unrepresentable
    // going forward; this says so out loud for anything already written, because there is no
    // alerting and a structured error log is the whole reporting surface (ADR-0053).
    if (!intent.paymentTxHash || !intent.payer || !intent.paymentAmount) {
      logger.error('Abandoned intent carries an incomplete payment reference; cannot refund it', {
        hasAmount: Boolean(intent.paymentAmount),
        hasPayer: Boolean(intent.payer),
        hasTxHash: Boolean(intent.paymentTxHash),
        intentId: intent.id,
        operation: intent.operation,
      });
      continue;
    }

    try {
      await handlePostPaymentFailure({
        amount: BigInt(intent.paymentAmount),
        context: intent.operation,
        db,
        error: new Error('Intent was never broadcast'),
        payer: intent.payer as `0x${string}`,
        paymentTxHash: intent.paymentTxHash as `0x${string}`,
      });
    } catch (error) {
      // Always throws by design (see onFailed below); only a genuine refund failure matters.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('refunded')) {
        logger.error('Refund for an abandoned intent did not complete', {
          error: message,
          intentId: intent.id,
          operation: intent.operation,
        });
      }
    }
  }
}

export function createRelayedIntentSettlement(): RelayedIntentSettlement {
  return {
    onConfirmed: async (transactionId: string, hash: Hex) => {
      const intent = await findIntentByTransactionId({
        db,
        serverWalletTransactionId: transactionId,
      });
      // Not every server-wallet transaction has an intent -- background work (indexer,
      // reconciliation, replacements) has nothing to complete.
      if (!intent) return;

      await completeRelayedIntent({ db, intent, txHash: hash });
    },

    sweepConfirmed: async (limit: number) => {
      // Only the intent's own recorded hash is used: the sweep is about work whose receipt is
      // already known good, so there is nothing to re-read from the chain, and a row with no
      // hash was never linked to a broadcast and has nothing to complete against.
      for (const intent of await listConfirmedUnsettledIntents({ db, limit })) {
        if (!intent.txHash) continue;
        // Late, not lost. Errors are already recorded on the intent by completeRelayedIntent,
        // and the next pass sees it again, so one bad intent must not end the sweep.
        await completeRelayedIntent({ db, intent, txHash: intent.txHash });
      }
    },

    onFailed: async (transactionId: string, reason: string) => {
      const intent = await findIntentByTransactionId({
        db,
        serverWalletTransactionId: transactionId,
      });
      if (!intent) return;
      if (intent.status === 'completed' || intent.status === 'failed') return;

      await markIntentFailed({ db, intentId: intent.id, reason });

      // The reconciler reaches onFailed only on a reverted receipt or a mined replacement, so
      // by here the chain has answered and the call this intent stood for provably did not
      // happen. That is the one precondition under which handing back a replay guard is safe:
      // release it on a timeout instead and a captured signature could be replayed while the
      // original transaction is still in a mempool, waiting to mine (ADR-0050).
      await releaseIntentGuard({ db, intent });

      // Refund only what this intent itself was paid for. An intent with no payment reference
      // has nothing to refund: whatever it was going to do on chain did not happen, and the
      // intent row records that, but no money of the caller's is sitting in the server wallet
      // waiting to be returned. Refunding on its behalf would have to guess whose payment it
      // meant, and the only available guess -- some earlier operation's -- is a double spend,
      // since that operation's own transaction succeeded and bought what it bought.
      //
      // As in the abandoned sweep above, `payment_required` decides which of the two meanings
      // an absent reference has (ADR-0067). A free write owes nothing; a payment-required
      // intent with no reference is a defect, and reporting the two identically is how a
      // pending payment would be written off as a free write.
      if (!intent.paymentTxHash && !intent.paymentAmount) {
        logger.error(
          intent.paymentRequired
            ? 'Relayed intent failed on chain and required payment, but carries no payment reference'
            : 'Relayed intent failed on chain; nothing to refund, it carried no payment',
          {
            intentId: intent.id,
            operation: intent.operation,
            paymentRequired: intent.paymentRequired,
            reason,
          }
        );
        return;
      }

      // Distinguished from the line above rather than folded into it, because the two mean
      // opposite things: "free write, nothing owed" is expected, while "money moved and we
      // cannot say how much" is a defect that leaves a payer out of pocket with no ledger row
      // to find them by. Reporting them identically is how the first one hid the second.
      if (!intent.paymentTxHash || !intent.payer || !intent.paymentAmount) {
        logger.error(
          'Confirmed-failed intent carries an incomplete payment reference; cannot refund it',
          {
            hasAmount: Boolean(intent.paymentAmount),
            hasPayer: Boolean(intent.payer),
            hasTxHash: Boolean(intent.paymentTxHash),
            intentId: intent.id,
            operation: intent.operation,
            reason,
          }
        );
        return;
      }

      // handlePostPaymentFailure always throws -- it is written for a request context where
      // throwing is how the caller learns. Here there is no caller left to inform, so the
      // throw is the expected outcome and only a genuine refund failure is worth logging.
      try {
        await handlePostPaymentFailure({
          amount: BigInt(intent.paymentAmount),
          context: intent.operation,
          db,
          error: new Error(reason),
          payer: intent.payer as `0x${string}`,
          paymentTxHash: intent.paymentTxHash as `0x${string}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('refunded')) {
          logger.error('Refund for a confirmed-failed intent did not complete', {
            error: message,
            intentId: intent.id,
            operation: intent.operation,
          });
        }
      }
    },
  };
}
