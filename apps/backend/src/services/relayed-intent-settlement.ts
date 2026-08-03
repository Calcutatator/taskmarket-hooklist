// Implements: ADR-0045
import type { Hex } from 'viem';

import { db } from '../db/client';
import type { RelayedIntentSettlement } from '../lib/server-transaction-reconciler';
import { logger } from '../lib/logger';
import { handlePostPaymentFailure } from './orphaned-payments';
import { completeRelayedIntent } from './relayed-intent-registry';
import { findIntentByTransactionId, markIntentFailed } from './relayed-intents';

/**
 * Joins the reconciler's on-chain verdict to the intent layer.
 *
 * This is where ADR-0045's central rule is enforced in practice: a refund is issued here and
 * only here, reached only from `onFailed`, which the reconciler calls only on a reverted
 * receipt or a mined replacement. There is deliberately no path from a timeout to this code.
 */
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

    onFailed: async (transactionId: string, reason: string) => {
      const intent = await findIntentByTransactionId({
        db,
        serverWalletTransactionId: transactionId,
      });
      if (!intent) return;
      if (intent.status === 'completed' || intent.status === 'failed') return;

      await markIntentFailed({ db, intentId: intent.id, reason });

      // Only the failure of a *root* can refund. The payment belongs to the root of the
      // chain (ADR-0046), and a root that failed bought nothing: no escrow was created, so
      // returning the payment is the only honest outcome.
      //
      // A follow-on is the opposite case, and refunding one would be a double spend. Reaching
      // a follow-on at all means its parent's transaction succeeded: the escrow is on chain,
      // funded, and holds the requester's money against a task that genuinely exists. Paying
      // the requester back while the contract still holds the same funds pays twice for one
      // task. What the requester is owed there is the missing follow-on effect -- an evaluator
      // assignment, say -- not their money back, and the intent row records exactly where the
      // chain stopped so that can be pursued. The parent's effect stands and is not retracted.
      if (intent.parentIntentId) {
        logger.error('Follow-on intent failed on chain; parent effect stands, no refund issued', {
          intentId: intent.id,
          operation: intent.operation,
          reason,
        });
        return;
      }

      // Past the guard above, the intent has no parent, so it is its own root.
      const root = intent;
      if (!root.paymentTxHash || !root.payer || !root.paymentAmount) return;

      // handlePostPaymentFailure always throws -- it is written for a request context where
      // throwing is how the caller learns. Here there is no caller left to inform, so the
      // throw is the expected outcome and only a genuine refund failure is worth logging.
      try {
        await handlePostPaymentFailure({
          amount: BigInt(root.paymentAmount),
          context: root.operation,
          db,
          error: new Error(reason),
          payer: root.payer as `0x${string}`,
          paymentTxHash: root.paymentTxHash as `0x${string}`,
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
