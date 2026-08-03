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
import { getPublicClient, getServerWallet } from './rpc-gateway';

export function createServerWallet() {
  return getServerWallet();
}

// Gas premium for a replacement transaction. Providers reject a replacement that does not
// raise the fee meaningfully, so this must clear the usual 10% minimum bump comfortably.
const REPLACEMENT_GAS_MULTIPLIER = 2n;

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
    getReceiptStatus: async (hash) => {
      const receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) return null;
      return receipt.status === 'success' ? 'success' : 'reverted';
    },
    sendReplacement: async (nonce) => {
      const fees = await publicClient.estimateFeesPerGas();
      // A zero-value self-transfer is the cheapest way to occupy a nonce. It supersedes a
      // stuck transaction at the same nonce and unblocks everything queued behind it.
      return wallet.client.sendTransaction({
        account: wallet.account,
        chain: wallet.client.chain,
        maxFeePerGas: fees.maxFeePerGas * REPLACEMENT_GAS_MULTIPLIER,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas * REPLACEMENT_GAS_MULTIPLIER,
        nonce,
        to: wallet.address,
        value: 0n,
      });
    },
    store: buildRuntimeStore(),
  });

  return startServerTransactionReconciler(reconcileOnce);
}
