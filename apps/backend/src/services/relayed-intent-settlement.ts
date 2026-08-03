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

      if (!intent.paymentTxHash || !intent.payer || !intent.paymentAmount) return;

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
