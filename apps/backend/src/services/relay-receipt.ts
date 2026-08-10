// Implements: ADR-0071
import { encodeAbiParameters, keccak256, slice } from 'viem';

import { getServerConfig } from '../config/env';
import { getPublicClient } from '../lib/rpc-gateway';

/**
 * The one question this module exists to make askable: **did this specific intent's relay call
 * land on chain?**
 *
 * `TaskMarketForwarder.relay` writes `consumedReceipts[receiptHash] = true` before it makes the
 * inner call, so the bit survives if and only if the whole relay succeeded -- a revert anywhere
 * downstream unwinds it with everything else. The hash is keyed on the intent's own
 * `receiptNonce`, thirty-two random bytes minted once per intent and replayed verbatim on every
 * attempt (ADR-0050), so nothing but this intent's own call can ever set it.
 *
 * That is what makes this usable where a transaction hash is not. The reconciler resolves every
 * other outcome by reading a receipt *by hash*, and a send whose connection dropped mid-call
 * never returned one; Ethereum JSON-RPC has no "transaction by sender and nonce" lookup, so
 * that mechanism dead-ends. This asks about the effect instead of the transaction, and the
 * effect is named exactly rather than recognised by shape.
 */
const CONSUMED_RECEIPTS_ABI = [
  {
    type: 'function',
    name: 'consumedReceipts',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * Recompute the forwarder's receipt key for a relay call.
 *
 * Must stay byte-identical to `TaskMarketForwarder.relay`:
 *
 *   keccak256(abi.encode(block.chainid, pgtrSender, paymentAmount, receiptNonce, validBefore,
 *                        taskMarket, selector))
 *
 * Called only from the broadcast path, where all seven inputs are in hand. It is deliberately
 * not called from the sweep: three of the inputs -- `pgtrSender`, `paymentAmount` and the
 * selector -- exist only inside the broadcast path and cannot be recovered from a stored
 * payload without re-running the broadcaster, which would send a second transaction. The hash
 * is therefore persisted on the intent, not derived on demand.
 */
export function computeRelayReceiptHash(input: {
  chainId: number;
  data: `0x${string}`;
  paymentAmount: bigint;
  pgtrSender: `0x${string}`;
  receiptNonce: `0x${string}`;
  taskMarket: `0x${string}`;
  validBefore: bigint;
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes4' },
      ],
      [
        BigInt(input.chainId),
        input.pgtrSender,
        input.paymentAmount,
        input.receiptNonce,
        input.validBefore,
        input.taskMarket,
        slice(input.data, 0, 4),
      ]
    )
  );
}

/**
 * Ask the forwarder whether a receipt has been consumed.
 *
 * Throws on an unanswered read rather than returning `false`, and that is the whole contract of
 * this function. A `false` here is a positive statement by the chain that this call has not
 * landed; an RPC error is not a statement about anything. Collapsing the two -- a timeout, an
 * unreachable node, a gateway 502 all reading as "not consumed" -- is precisely the mistake
 * ADR-0069 was written about, and here it would refund a payer for a task they already hold.
 * The caller is required to distinguish them, and the type system makes it hard not to.
 */
export async function relayReceiptWasConsumed(receiptHash: `0x${string}`): Promise<boolean> {
  return (await getPublicClient().readContract({
    abi: CONSUMED_RECEIPTS_ABI,
    address: getServerConfig().FORWARDER_ADDRESS as `0x${string}`,
    args: [receiptHash],
    functionName: 'consumedReceipts',
  })) as boolean;
}
