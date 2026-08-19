// Implements: ADR-0092
import { PERMIT2_ADDRESS, eip3009ABI } from '@x402/evm';
import { createPublicClient, defineChain, getAddress, http } from 'viem';

import { getX402Payment, transitionX402Payment, type X402PaymentRecord } from './x402-journal.js';
import { loadX402Policy, rpcUrlForNetwork } from './x402-policy.js';

const permit2NonceBitmapAbi = [
  {
    type: 'function',
    name: 'nonceBitmap',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'wordPos', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

function chainIdOf(network: string): number {
  if (!/^eip155:[1-9]\d*$/.test(network)) throw new Error(`Invalid EVM network ${network}`);
  const value = Number(network.slice('eip155:'.length));
  if (!Number.isSafeInteger(value)) throw new Error(`EVM chain id is too large: ${network}`);
  return value;
}

async function authorizationWasUsed(record: X402PaymentRecord): Promise<boolean> {
  if (!record.nonce || !record.authorizationKind) {
    throw new Error(`x402 payment '${record.id}' has no recorded authorization nonce`);
  }
  const policy = await loadX402Policy();
  const chainId = chainIdOf(record.network);
  const rpcUrl = rpcUrlForNetwork(policy, record.network);
  const chain = defineChain({
    id: chainId,
    name: record.network,
    nativeCurrency: { name: 'Native gas token', symbol: 'GAS', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  const rpcChainId = await client.getChainId();
  if (rpcChainId !== chainId) {
    throw new Error(`RPC chain id ${rpcChainId} does not match ${record.network}`);
  }

  if (record.transaction) {
    try {
      const receipt = await client.getTransactionReceipt({
        hash: record.transaction as `0x${string}`,
      });
      if (receipt.status === 'success') return true;
    } catch {
      // A missing receipt is not evidence that the payment failed. Continue to nonce state.
    }
  }

  if (record.authorizationKind === 'eip3009') {
    if (!/^0x[a-fA-F0-9]{64}$/.test(record.nonce)) {
      throw new Error(`x402 payment '${record.id}' has an invalid EIP-3009 nonce`);
    }
    return (await client.readContract({
      address: getAddress(record.asset),
      abi: eip3009ABI,
      functionName: 'authorizationState',
      args: [getAddress(record.payer), record.nonce as `0x${string}`],
    })) as boolean;
  }

  const nonce = BigInt(record.nonce);
  const bitmap = (await client.readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2NonceBitmapAbi,
    functionName: 'nonceBitmap',
    args: [getAddress(record.payer), nonce >> 8n],
  })) as bigint;
  return (bitmap & (1n << (nonce & 255n))) !== 0n;
}

export async function reconcileX402Payment(id: string): Promise<X402PaymentRecord> {
  const record = await getX402Payment(id);
  if (
    ['settled', 'failed_before_dispatch', 'expired_unspent', 'manually_resolved'].includes(
      record.state
    )
  ) {
    return record;
  }
  if (['reserved', 'approval_pending', 'ready'].includes(record.state)) {
    return transitionX402Payment(id, {
      state: 'failed_before_dispatch',
      error: 'No payment-bearing request was dispatched',
    });
  }
  const used = await authorizationWasUsed(record);
  if (used) {
    if (record.scheme === 'exact') {
      return transitionX402Payment(id, {
        state: 'settled',
        settledAmount: record.authorizedAmount,
        error: undefined,
      });
    }
    return transitionX402Payment(id, {
      state: 'settled_amount_unknown',
      error: 'Authorization was consumed, but the actual upto settlement amount is unknown',
    });
  }
  if (!record.authorizationExpiresAt) {
    throw new Error(`x402 payment '${id}' has no recorded authorization expiry`);
  }
  if (new Date(record.authorizationExpiresAt).getTime() > Date.now()) {
    return record;
  }
  return transitionX402Payment(id, {
    state: 'expired_unspent',
    settledAmount: '0',
    error: undefined,
  });
}
