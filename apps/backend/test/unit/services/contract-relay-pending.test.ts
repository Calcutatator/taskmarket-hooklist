// Verifies: ADR-0045, ADR-0048
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const TX_HASH = `0x${'7c'.repeat(32)}` as `0x${string}`;
const TASK_ID = `0x${'11'.repeat(32)}` as `0x${string}`;
const REQUESTER = '0x2222222222222222222222222222222222222222' as `0x${string}`;

const dispatchServerWalletTransaction = vi.fn();

vi.mock('../../../src/lib/wallet', () => ({
  createServerWallet: () => ({
    account: { address: '0x3333333333333333333333333333333333333333' },
    address: '0x3333333333333333333333333333333333333333',
    client: { writeContract: vi.fn() },
  }),
  dispatchServerWalletTransaction: (...args: unknown[]) =>
    dispatchServerWalletTransaction(...args),
}));

vi.mock('../../../src/lib/rpc-gateway', () => ({
  getPublicClient: () => ({
    estimateFeesPerGas: vi.fn(async () => ({
      maxFeePerGas: 1_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
    })),
    readContract: vi.fn(),
    simulateContract: vi.fn(async () => ({})),
    waitForTransactionReceipt: vi.fn(),
  }),
  runWithRpcApplicationAttempt: async (_attempt: number, run: () => unknown) => run(),
}));

const { ServerTransactionPendingError } = await import(
  '../../../src/lib/server-transaction-dispatcher'
);
const { contractEvaluatorTimeout } = await import('../../../src/services/contract');

afterAll(restoreServerEnvironment);

/**
 * The relay retry loop exists for RPC read-after-write lag: a simulation that has not yet seen
 * the state a just-mined transaction wrote is worth trying again. A receipt timeout is the
 * opposite kind of event -- the transaction was accepted, it has a hash, and it is in the
 * mempool. Retrying it spends a second nonce on the same work, and swallowing it denies the
 * hash to the two callers written to persist it (relayed-intent-request.ts,
 * relayed-intent-registry.ts), which leaves the intent looking like one that never reached the
 * chain and therefore refundable (ADR-0045, ADR-0048).
 */
describe('relay retry loop and a live transaction', () => {
  beforeEach(() => {
    dispatchServerWalletTransaction.mockReset();
  });

  it('propagates ServerTransactionPendingError instead of retrying it', async () => {
    dispatchServerWalletTransaction.mockRejectedValue(
      new ServerTransactionPendingError(TX_HASH, 7)
    );

    await expect(contractEvaluatorTimeout(TASK_ID, REQUESTER)).rejects.toBeInstanceOf(
      ServerTransactionPendingError
    );

    // One attempt, not six. A second attempt is a second nonce spent on work already live.
    expect(dispatchServerWalletTransaction).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('carries the live hash through to the caller that persists it', async () => {
    dispatchServerWalletTransaction.mockRejectedValue(
      new ServerTransactionPendingError(TX_HASH, 7)
    );

    await expect(contractEvaluatorTimeout(TASK_ID, REQUESTER)).rejects.toMatchObject({
      hash: TX_HASH,
    });
  }, 60_000);
});
