// Implements: ADR-0045
import type { Hex } from 'viem';

import { db } from '../db/client';
import type { RelayedIntentSettlement } from '../lib/server-transaction-reconciler';
import { logger } from '../lib/logger';
import { handlePostPaymentFailure } from './orphaned-payments';
import { completeRelayedIntent } from './relayed-intent-registry';
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
 * Refund payments whose intent never reached the chain at all.
 *
 * The reconciler settles transactions, so it can only speak for intents that have one. An
 * intent stuck in `recorded` has no transaction and never will -- there is no verdict coming,
 * and without this the payer would simply never be repaid. It is still the same rule ADR-0045
 * states and ADR-0048 places here: a refund is issued only when the system knows the work did
 * not happen, and "no nonce was ever allocated for it" is knowing that, not guessing it.
 *
 * Scoped to intents with no linked outbox row and no hash, so an intent whose transaction is
 * live but whose linking write was lost is never mistaken for one that never started.
 */
export async function settleAbandonedIntents(limit: number): Promise<void> {
  const cutoff = new Date(Date.now() - ABANDONED_INTENT_CUTOFF_MS);
  for (const intent of await listAbandonedIntents({ cutoff, db, limit })) {
    if (intent.serverWalletTransactionId || intent.txHash) continue;
    if (!intent.paymentTxHash || !intent.payer || !intent.paymentAmount) continue;

    await markIntentFailed({
      db,
      intentId: intent.id,
      reason: 'Intent was never broadcast; no transaction was ever sent for it',
    });

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

      // Refund only what this intent itself was paid for. An intent with no payment reference
      // has nothing to refund: whatever it was going to do on chain did not happen, and the
      // intent row records that, but no money of the caller's is sitting in the server wallet
      // waiting to be returned. Refunding on its behalf would have to guess whose payment it
      // meant, and the only available guess -- some earlier operation's -- is a double spend,
      // since that operation's own transaction succeeded and bought what it bought.
      if (!intent.paymentTxHash || !intent.payer || !intent.paymentAmount) {
        logger.error('Relayed intent failed on chain; nothing to refund, it carried no payment', {
          intentId: intent.id,
          operation: intent.operation,
          reason,
        });
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
