/**
 * What a first send is willing to pay per gas.
 *
 * Verifies: ADR-0076
 *
 * `getGasParams` doubles whatever the fee oracle returns, and nothing bounded the result: ADR-0051
 * had given the replacement path a ceiling while the send every paid write makes had none. A
 * sandbox run drained its relayer wallet of 5,716 ETH through that gap, each send raising the base
 * fee that priced the next one.
 *
 * These drive the ceiling through the public relay path rather than calling `getGasParams`
 * directly, because the fees that matter are the ones handed to the dispatcher -- a ceiling
 * applied correctly inside a helper and dropped on the way out would pass a direct test.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const TASK_ID = `0x${'11'.repeat(32)}` as `0x${string}`;
const REQUESTER = '0x2222222222222222222222222222222222222222' as `0x${string}`;

/** Well above any ceiling under test, so the doubling always wants more than it may have. */
const ORACLE_MAX_FEE = 1_000_000_000n;
const ORACLE_PRIORITY = 500_000_000n;

const CEILING = '750000000';

const restoreServerEnvironment = stubServerEnvironment();
// Set before `services/contract` is imported below: the config is read through `getServerConfig`,
// and a value stubbed after the module has resolved it would not be seen.
vi.stubEnv('REPLACEMENT_GAS_MAX_FEE_WEI', CEILING);

const dispatchServerWalletTransaction = vi.fn();

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
      maxFeePerGas: ORACLE_MAX_FEE,
      maxPriorityFeePerGas: ORACLE_PRIORITY,
    })),
    readContract: vi.fn(),
    simulateContract: vi.fn(async () => ({})),
    waitForTransactionReceipt: vi.fn(),
  }),
  runWithRpcApplicationAttempt: async (_attempt: number, run: () => unknown) => run(),
}));

const { contractEvaluatorTimeout } = await import('../../../src/services/contract');

afterAll(restoreServerEnvironment);

/**
 * The fees the relay handed the dispatcher on its first attempt.
 *
 * Reads the first call rather than awaiting the whole relay: the loop sleeps six seconds between
 * attempts (ADR-0075), so waiting for it to finish would make this a test of the retry budget's
 * wall-clock. The pricing decision is made once, before the first dispatch, which is the moment
 * this cares about.
 */
async function feesForOneSend(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  dispatchServerWalletTransaction.mockRejectedValue(new Error('stop after one attempt'));
  void contractEvaluatorTimeout(TASK_ID, REQUESTER).catch(() => undefined);
  for (let i = 0; i < 200 && dispatchServerWalletTransaction.mock.calls.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const first = dispatchServerWalletTransaction.mock.calls[0] as [{ fees: unknown }] | undefined;
  if (!first) throw new Error('the relay never reached the dispatcher');
  return first[0].fees as { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
}

describe('a first send is bounded by the absolute fee ceiling', () => {
  beforeEach(() => {
    dispatchServerWalletTransaction.mockReset();
  });

  it('clamps maxFeePerGas to the ceiling rather than paying the doubled oracle', async () => {
    // Unbounded, this send would offer 2,000,000,000 wei per gas. The ceiling is the only thing
    // between the doubling and whatever the oracle happens to say.
    const { maxFeePerGas } = await feesForOneSend();

    expect(maxFeePerGas).toBe(BigInt(CEILING));
    expect(maxFeePerGas).toBeLessThan(ORACLE_MAX_FEE * 2n);
  });

  it('holds the priority fee under the ceiling too, not just under the max fee', async () => {
    // Asserted against the ceiling rather than against `maxFeePerGas`: the doubled priority fee
    // is below the doubled max fee anyway, so `priority <= maxFee` holds with no ceiling at all
    // and would pass on the unfixed source. The ceiling is the bound that actually moved.
    const { maxFeePerGas, maxPriorityFeePerGas } = await feesForOneSend();

    expect(maxPriorityFeePerGas).toBeLessThanOrEqual(BigInt(CEILING));
    expect(maxPriorityFeePerGas).toBeLessThanOrEqual(maxFeePerGas);
  });

  it('still sends: clamping prices the transaction, it does not refuse it', async () => {
    // The half that must not regress. Refusing would turn a fee spike into a failed paid write;
    // clamping degrades to slow, which the replacement path already knows how to rescue.
    await feesForOneSend();

    expect(dispatchServerWalletTransaction).toHaveBeenCalled();
  });
});
