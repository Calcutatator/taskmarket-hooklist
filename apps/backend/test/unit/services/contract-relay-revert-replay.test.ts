// Verifies: ADR-0049, ADR-0070, ADR-0074
import { BaseError } from 'viem';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubServerEnvironment } from '../../helpers/server-environment';

const restoreServerEnvironment = stubServerEnvironment();

const TX_HASH = `0x${'7c'.repeat(32)}` as `0x${string}`;
const TASK_ID = `0x${'11'.repeat(32)}` as `0x${string}`;
const REQUESTER = '0x2222222222222222222222222222222222222222' as `0x${string}`;

const dispatchServerWalletTransaction = vi.fn();
const writeContract = vi.fn();
const simulateContract = vi.fn(async (_call: unknown) => ({}));

vi.mock('../../../src/lib/wallet', () => ({
  createServerWallet: () => ({
    account: { address: '0x3333333333333333333333333333333333333333' },
    address: '0x3333333333333333333333333333333333333333',
    client: { writeContract: (...args: unknown[]) => writeContract(...args) },
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
    simulateContract: (arg: unknown) => simulateContract(arg),
    waitForTransactionReceipt: vi.fn(),
  }),
  runWithRpcApplicationAttempt: async (_attempt: number, run: () => unknown) => run(),
}));

const { contractEvaluatorTimeout } = await import('../../../src/services/contract');
const { classifyRelayFailure, UndeterminedRelayError } = await import(
  '../../../src/lib/relay-failure'
);

afterAll(restoreServerEnvironment);

type RelayArgs = readonly [`0x${string}`, bigint, bigint, `0x${string}`, `0x${string}`];

function relayCalls() {
  return simulateContract.mock.calls
    .map(([arg]) => arg as unknown as { functionName?: string; args?: RelayArgs })
    .filter((call) => call?.functionName === 'relay');
}

/** A viem-shaped revert carrying a raw selector, the form `decodeRelayRevert` reads. */
function revertingError(selector: string): Error {
  const error = new BaseError('execution reverted');
  (error as BaseError & { data?: string }).data = selector;
  return error;
}

/**
 * When a relayed transaction mines with a failed receipt, the revert reason is recovered by
 * replaying the call through eth_call and decoding what it throws.
 *
 * The replay used to be issued with a freshly generated receipt nonce and a freshly computed
 * deadline. That quietly excluded the two failures most worth identifying: a relay that reverted
 * ReceiptExpired or ReceiptAlreadyUsed cannot reproduce under an envelope that is neither expired
 * nor used. The replay would simply succeed, nothing would be decoded, and `revertReason` would
 * stay at its initialised 'unknown revert' -- which classifyRelayFailure reads as transient. A
 * permanent failure arriving that way was indistinguishable from a retryable one.
 *
 * So the replay has to carry the original envelope. These tests pin that, and pin that it stays a
 * read-only call while doing so.
 */
describe('revert-reason replay uses the original relay envelope', () => {
  beforeEach(() => {
    dispatchServerWalletTransaction.mockReset();
    writeContract.mockReset();
    simulateContract.mockClear();
    // The send's own simulate succeeds; the replay reverts with a selector KNOWN_ERRORS names.
    // A replay that decodes nothing is a different case entirely and has its own describe below.
    simulateContract.mockImplementation(async (call: unknown) => {
      const isRelay = (call as { functionName?: string })?.functionName === 'relay';
      // Relay simulates alternate send, replay, send, replay -- odd ones are the send's own.
      if (!isRelay || relayCalls().length % 2 === 1) return {};
      throw revertingError('0x91edfffa');
    });

    // Run the caller's own simulate() so the send-path relay args are recorded, then hand back a
    // mined-but-failed receipt to drive the revert-decoding branch.
    dispatchServerWalletTransaction.mockImplementation(async (opts: { simulate: () => unknown }) => {
      await opts.simulate();
      return { hash: TX_HASH, receipt: { status: 'reverted', blockNumber: 1n, logs: [] } };
    });
  });

  it('replays with the same nonce and deadline the send used', async () => {
    await expect(contractEvaluatorTimeout(TASK_ID, REQUESTER)).rejects.toThrow(
      /Contract call rejected/
    );

    const calls = relayCalls();
    expect(calls).toHaveLength(2);

    const [sent, replayed] = calls;
    const [, , sentValidBefore, sentNonce] = sent.args as RelayArgs;
    const [, , replayValidBefore, replayNonce] = replayed.args as RelayArgs;

    // The whole point: a regenerated nonce or deadline makes ReceiptAlreadyUsed and
    // ReceiptExpired unreproducible, and those are exactly the reasons being recovered.
    expect(replayNonce).toBe(sentNonce);
    expect(replayValidBefore).toBe(sentValidBefore);
  }, 60_000);

  it('replays the rest of the call unchanged too', async () => {
    await expect(contractEvaluatorTimeout(TASK_ID, REQUESTER)).rejects.toThrow(
      /Contract call rejected/
    );

    const [sent, replayed] = relayCalls();
    // Sender, payment and calldata must match as well -- a replay that differs in any argument
    // is not reproducing the transaction whose revert is being read.
    expect(replayed.args).toStrictEqual(sent.args);
  }, 60_000);

  it('reuses each call own envelope rather than one fixed value', async () => {
    // Two independent relays. Within each, the replay must match that relay's send; across the
    // two, the envelopes must differ -- otherwise "replay matches send" could be satisfied by a
    // constant, which would reintroduce the cross-transaction confusion the nonce exists to stop.
    await expect(contractEvaluatorTimeout(TASK_ID, REQUESTER)).rejects.toThrow();
    await expect(contractEvaluatorTimeout(TASK_ID, REQUESTER)).rejects.toThrow();

    const calls = relayCalls();
    expect(calls).toHaveLength(4);

    const [firstSend, firstReplay, secondSend, secondReplay] = calls.map(
      (call) => call.args as RelayArgs
    );
    expect(firstReplay[3]).toBe(firstSend[3]);
    expect(secondReplay[3]).toBe(secondSend[3]);
    expect(secondSend[3]).not.toBe(firstSend[3]);
  }, 60_000);

  it('never broadcasts while recovering the reason', async () => {
    await expect(contractEvaluatorTimeout(TASK_ID, REQUESTER)).rejects.toThrow(
      /Contract call rejected/
    );

    // Reusing a live nonce is only safe because this path is eth_call and nothing else. The
    // dispatcher ran once, for the original send; the replay must not have gone near it.
    expect(dispatchServerWalletTransaction).toHaveBeenCalledTimes(1);
    expect(writeContract).not.toHaveBeenCalled();
  }, 60_000);

  it('names the decoded reason, which is what this replay exists to recover', async () => {
    // The case the whole mechanism is for, pinned explicitly rather than implied by the regex
    // the envelope tests use: a caller matching on `SubmissionNotFound` still sees it, and
    // classifyRelayFailure still reads the prefix as deterministic.
    await expect(contractEvaluatorTimeout(TASK_ID, REQUESTER)).rejects.toThrow(
      'Contract call rejected: SubmissionNotFound'
    );
  }, 60_000);
});

/**
 * A failed receipt whose revert the replay cannot reproduce establishes nothing.
 *
 * This is the branch a sandbox run caught lying. `revertReason` had no value, the throw said
 * `Contract call rejected: unknown revert` anyway, and the intent it said that about completed
 * thirty seconds later with a successful receipt -- so the caller was told the exact opposite of
 * what happened. ADR-0049 already has a state for this and it is not failure.
 */
describe('an undecodable relay failure is reported as undetermined, not as a rejection', () => {
  beforeEach(() => {
    dispatchServerWalletTransaction.mockReset();
    writeContract.mockReset();
    simulateContract.mockClear();
    // Every simulate succeeds, including the replay: nothing to decode, nothing established.
    simulateContract.mockImplementation(async () => ({}));
    dispatchServerWalletTransaction.mockImplementation(async (opts: { simulate: () => unknown }) => {
      await opts.simulate();
      return { hash: TX_HASH, receipt: { status: 'reverted', blockNumber: 1n, logs: [] } };
    });
  });

  it('does not assert that the contract rejected the call', async () => {
    const error = await contractEvaluatorTimeout(TASK_ID, REQUESTER).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UndeterminedRelayError);
    expect((error as Error).message).not.toContain('Contract call rejected');
    expect((error as Error).message).not.toContain('unknown revert');
    expect((error as Error).message).toMatch(/may still be landing/);
  }, 60_000);

  it('carries the hash of the transaction that is still out there', async () => {
    // Without it the caller has no handle and the sweep has no way to know a nonce was spent.
    const error = (await contractEvaluatorTimeout(TASK_ID, REQUESTER).catch(
      (err: unknown) => err
    )) as InstanceType<typeof UndeterminedRelayError>;

    expect(error.txHash).toBe(TX_HASH);
  }, 60_000);

  it('classifies as transient, without the message being what says so', async () => {
    const error = await contractEvaluatorTimeout(TASK_ID, REQUESTER).catch((err: unknown) => err);

    expect(classifyRelayFailure(error)).toBe('transient');
  }, 60_000);
});
