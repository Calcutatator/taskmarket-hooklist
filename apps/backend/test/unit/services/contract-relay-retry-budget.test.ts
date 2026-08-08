/**
 * How many attempts a relay failure is worth.
 *
 * Verifies: ADR-0075
 *
 * The loop retries for one reason -- RPC read-after-write lag, where a node that has confirmed a
 * receipt still simulates against pre-transaction state -- and it used to spend the full budget on
 * every failure regardless. A deterministic revert therefore cost six attempts, five nonces from
 * the database-coordinated allocator, and about thirty seconds to arrive at the answer the first
 * attempt already had.
 *
 * These assert the counts rather than the timing: the wall-clock is a consequence of the attempt
 * count and the delay, and asserting on elapsed time would make the test a clock rather than a
 * statement about the rule.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const TASK_ID = `0x${'11'.repeat(32)}` as `0x${string}`;
const REQUESTER = '0x2222222222222222222222222222222222222222' as `0x${string}`;

const dispatchServerWalletTransaction = vi.fn();
const simulateContract = vi.fn(async () => ({}));

vi.mock('../../../src/lib/wallet', () => ({
  createServerWallet: () => ({
    account: { address: '0x3333333333333333333333333333333333333333' },
    address: '0x3333333333333333333333333333333333333333',
    client: { writeContract: vi.fn() },
  }),
  dispatchServerWalletTransaction: (...args: unknown[]) => dispatchServerWalletTransaction(...args),
}));

vi.mock('../../../src/lib/rpc-gateway', () => ({
  getPublicClient: () => ({
    estimateFeesPerGas: vi.fn(async () => ({
      maxFeePerGas: 1_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
    })),
    readContract: vi.fn(),
    simulateContract: () => simulateContract(),
    waitForTransactionReceipt: vi.fn(),
  }),
  runWithRpcApplicationAttempt: async (_attempt: number, run: () => unknown) => run(),
}));

const { contractEvaluatorTimeout } = await import('../../../src/services/contract');
const { DeterministicRelayError } = await import('../../../src/lib/relay-failure');

afterAll(restoreServerEnvironment);

/**
 * Drive the relay loop to exhaustion against a failure it will never get past, and report how
 * many attempts it made.
 *
 * Fake timers, because the delay between attempts is six real seconds and the transient budget
 * spans five of them. `advanceTimersByTimeAsync` in a loop lets the awaited sleep resolve without
 * the test knowing how many there will be.
 */
async function attemptsBefore(giveUp: Error): Promise<number> {
  dispatchServerWalletTransaction.mockRejectedValue(giveUp);
  vi.useFakeTimers();
  try {
    const call = contractEvaluatorTimeout(TASK_ID, REQUESTER).catch(() => undefined);
    // Enough passes to clear the largest budget's gaps; extra passes are harmless no-ops once the
    // loop has stopped.
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(6000);
    await call;
    return dispatchServerWalletTransaction.mock.calls.length;
  } finally {
    vi.useRealTimers();
  }
}

describe('the relay loop spends attempts according to what failed', () => {
  beforeEach(() => {
    dispatchServerWalletTransaction.mockReset();
    simulateContract.mockClear();
  });

  it('gives a deterministic failure two attempts, not six', async () => {
    // The saving this decision exists for: four attempts and four nonces not spent reaching a
    // verdict the chain gave on the first one.
    expect(await attemptsBefore(new DeterministicRelayError('SubmissionNotFound'))).toBe(2);
  });

  it('still gives a transient failure the full six', async () => {
    // The half that must not regress. A transport failure reached no verdict at all, so a later
    // attempt genuinely can answer differently -- which is the whole reason the loop exists.
    expect(await attemptsBefore(new Error('socket hang up'))).toBe(6);
  });
});
