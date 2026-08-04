import { randomUUID } from 'node:crypto';
import { db } from '../db/client';
import { getServerConfig } from '../config/env';
import {
  createServerTransactionDispatcher,
  type ServerTransactionRequest,
} from './server-transaction-dispatcher';
import {
  createServerTransactionReconciler,
  startServerTransactionReconciler,
} from './server-transaction-reconciler';
import { createDrizzleServerTransactionStore } from './server-transaction-store';
import { computeReplacementFees, type ReplacementGasPolicy } from './replacement-gas';
import { logger } from './logger';
import { getPublicClient, getServerWallet } from './rpc-gateway';
import { createRelayedIntentSettlement } from '../services/relayed-intent-settlement';

export function createServerWallet() {
  return getServerWallet();
}

// Implements: ADR-0051
// The escalation policy for replacement gas, read once per replacement so an operator can
// change it during an incident without a deploy.
function readReplacementGasPolicy(): ReplacementGasPolicy {
  const config = getServerConfig();
  return {
    escalationPct: BigInt(config.REPLACEMENT_GAS_ESCALATION_PCT),
    firstBumpPct: BigInt(config.REPLACEMENT_GAS_FIRST_BUMP_PCT),
    maxFeeWei:
      config.REPLACEMENT_GAS_MAX_FEE_WEI === undefined ? null : config.REPLACEMENT_GAS_MAX_FEE_WEI,
    maxMultiple: BigInt(config.REPLACEMENT_GAS_MAX_MULTIPLE),
  };
}

function buildRuntimeStore() {
  const wallet = getServerWallet();
  return createDrizzleServerTransactionStore({
    chainId: getServerConfig().CHAIN_ID,
    database: db,
    newId: () => randomUUID(),
    walletAddress: wallet.address,
  });
}

function readPendingNonce(): Promise<number> {
  const wallet = getServerWallet();
  return getPublicClient().getTransactionCount({
    address: wallet.address,
    blockTag: 'pending',
  });
}

let runtimeTransactionDispatcher: ReturnType<typeof createServerTransactionDispatcher> | undefined;

function getRuntimeTransactionDispatcher() {
  if (!runtimeTransactionDispatcher) {
    runtimeTransactionDispatcher = createServerTransactionDispatcher({
      getPendingNonce: readPendingNonce,
      store: buildRuntimeStore(),
    });
  }
  return runtimeTransactionDispatcher;
}

/**
 * Run one server-wallet transaction through the durable dispatcher. Every production write
 * from createServerWallet() must go through this function: it owns nonce allocation, and a
 * write that bypasses it can reuse a nonce the allocator has already handed out.
 */
export function dispatchServerWalletTransaction<Receipt>(
  request: ServerTransactionRequest<Receipt>
) {
  return getRuntimeTransactionDispatcher()(request);
}

/**
 * Start the background reconciler that settles transactions outliving their request and
 * clears nonces that would otherwise block every higher nonce behind them.
 */
export function startServerWalletReconciler(): NodeJS.Timeout {
  const wallet = getServerWallet();
  const publicClient = getPublicClient();

  const reconcileOnce = createServerTransactionReconciler({
    // Settles the durable intent behind each transaction once the chain has answered, and is
    // the only route to a refund (ADR-0045).
    intents: createRelayedIntentSettlement(),
    getReceiptStatus: async (hash) => {
      const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) return null;
      return receipt.status === 'success' ? 'success' : 'reverted';
    },
    sendReplacement: async ({ nonce, originalFees, previousFees }) => {
      const oracle = await publicClient.estimateFeesPerGas();
      const decision = computeReplacementFees({
        oracle: {
          maxFeePerGas: oracle.maxFeePerGas,
          maxPriorityFeePerGas: oracle.maxPriorityFeePerGas,
        },
        original: originalFees,
        policy: readReplacementGasPolicy(),
        previous: previousFees,
      });

      if (decision.cappedBelowOpeningBid) {
        // The cap alone is holding this attempt below what the market currently says is
        // sufficient, which means REPLACEMENT_GAS_MAX_MULTIPLE is too low for the fee regime
        // this deployment is now in. Logged by name rather than refused: clearing the nonce
        // never stops, and an underpriced attempt is strictly better than none (ADR-0051).
        logger.error('Replacement gas cap is below the current oracle-derived opening bid', {
          maxFeePerGas: decision.fees.maxFeePerGas.toString(),
          nonce,
          oracleMaxFeePerGas: oracle.maxFeePerGas.toString(),
          originalMaxFeePerGas: originalFees?.maxFeePerGas.toString() ?? null,
        });
      }

      // A zero-value self-transfer is the cheapest way to occupy a nonce. It supersedes a
      // stuck transaction at the same nonce and unblocks everything queued behind it.
      const hash = await wallet.client.sendTransaction({
        account: wallet.account,
        chain: wallet.client.chain,
        maxFeePerGas: decision.fees.maxFeePerGas,
        maxPriorityFeePerGas: decision.fees.maxPriorityFeePerGas,
        nonce,
        to: wallet.address,
        value: 0n,
      });
      // The fee goes back to the reconciler to be persisted: it is the base the *next*
      // escalation multiplies, and re-reading the oracle in its place is the defect fixed here.
      return { fees: decision.fees, hash };
    },
    store: buildRuntimeStore(),
  });

  return startServerTransactionReconciler(reconcileOnce);
}
