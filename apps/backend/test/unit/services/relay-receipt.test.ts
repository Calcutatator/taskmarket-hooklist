// Verifies: ADR-0071
import { afterAll, describe, expect, it, vi } from 'vitest';

import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const readContract = vi.fn();
vi.mock('../../../src/lib/rpc-gateway', () => ({
  getPublicClient: () => ({ readContract }),
  runWithRpcOperation: (_name: string, fn: () => unknown) => fn(),
}));

const { computeRelayReceiptHash, relayReceiptWasConsumed } =
  await import('../../../src/services/relay-receipt');

/**
 * The whole mechanism rests on this hash being byte-identical to the one
 * `TaskMarketForwarder.relay` computes. If it drifts, every stranded intent reads as "never
 * landed" -- and past its deadline that means refunding work that is on chain, which is the
 * exact loss this was built to prevent. So the expected value is not produced by the code under
 * test, nor by another viem call: it comes from Foundry, evaluating the Solidity expression
 * directly.
 *
 *   cast abi-encode "f(uint256,address,uint256,bytes32,uint256,address,bytes4)" \
 *     8453 0x1111...11 1000000 0x2222...22 1786029192 0x3333...33 0xdeadbeef | cast keccak
 */
describe('computeRelayReceiptHash', () => {
  it('reproduces the forwarder receipt hash byte for byte', () => {
    expect(
      computeRelayReceiptHash({
        chainId: 8453,
        data: `0xdeadbeef${'00'.repeat(32)}`,
        paymentAmount: 1_000_000n,
        pgtrSender: `0x${'11'.repeat(20)}`,
        receiptNonce: `0x${'22'.repeat(32)}`,
        taskMarket: `0x${'33'.repeat(20)}`,
        validBefore: 1_786_029_192n,
      })
    ).toBe('0x99ba1fdf70fbfe86a31d2b8e6461b405640c9d5e677c31a0cd24c980cb1782d1');
  });

  it('takes only the selector from the calldata, so arguments never move the hash', () => {
    const base = {
      chainId: 8453,
      paymentAmount: 1_000_000n,
      pgtrSender: `0x${'11'.repeat(20)}` as const,
      receiptNonce: `0x${'22'.repeat(32)}` as const,
      taskMarket: `0x${'33'.repeat(20)}` as const,
      validBefore: 1_786_029_192n,
    };
    expect(computeRelayReceiptHash({ ...base, data: `0xdeadbeef${'00'.repeat(32)}` })).toBe(
      computeRelayReceiptHash({ ...base, data: `0xdeadbeef${'ff'.repeat(96)}` })
    );
  });

  it('gives a different hash for a different receipt nonce, so it identifies one intent', () => {
    const base = {
      chainId: 8453,
      data: `0xdeadbeef` as const,
      paymentAmount: 0n,
      pgtrSender: `0x${'11'.repeat(20)}` as const,
      taskMarket: `0x${'33'.repeat(20)}` as const,
      validBefore: 1_786_029_192n,
    };
    expect(computeRelayReceiptHash({ ...base, receiptNonce: `0x${'22'.repeat(32)}` })).not.toBe(
      computeRelayReceiptHash({ ...base, receiptNonce: `0x${'23'.repeat(32)}` })
    );
  });
});

describe('relayReceiptWasConsumed', () => {
  it('reports what the forwarder says', async () => {
    readContract.mockResolvedValueOnce(true);
    expect(await relayReceiptWasConsumed(`0x${'ab'.repeat(32)}`)).toBe(true);
    readContract.mockResolvedValueOnce(false);
    expect(await relayReceiptWasConsumed(`0x${'ab'.repeat(32)}`)).toBe(false);
  });

  it('throws rather than answering false when the read itself fails', async () => {
    // The single most dangerous thing this module could do is turn an unreachable node into
    // "this call never landed". Past the deadline that answer refunds a payer for a task they
    // already hold, out of the server wallet. The read must fail loudly instead.
    readContract.mockRejectedValueOnce(new Error('gateway 502'));
    await expect(relayReceiptWasConsumed(`0x${'ab'.repeat(32)}`)).rejects.toThrow('gateway 502');
  });
});

afterAll(() => {
  restoreServerEnvironment();
});
