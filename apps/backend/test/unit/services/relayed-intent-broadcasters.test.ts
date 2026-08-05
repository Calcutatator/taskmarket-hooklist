// Verifies: ADR-0050
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every contract wrapper a broadcaster can reach, stubbed so the assertion is about the call
 * that would have been made rather than about the chain.
 *
 * The three that resolve to an object rather than a bare hash are the ones whose request paths
 * unwrap a field (`txHash` / `hash`); a broadcaster that forgot to unwrap would return an
 * object where the registry expects a hash, so the shape is part of what is under test.
 */
vi.mock('../../../src/services/contract', () => ({
  contractAcceptAuction: vi.fn().mockResolvedValue('0xauctionaccept'),
  contractAcceptSubmission: vi.fn().mockResolvedValue('0xaccept'),
  contractAcceptSubmissions: vi.fn().mockResolvedValue('0xacceptmany'),
  contractAppeal: vi.fn().mockResolvedValue('0xappeal'),
  contractAssignEvaluator: vi.fn().mockResolvedValue('0xassign'),
  contractCancelTask: vi.fn().mockResolvedValue('0xcancel'),
  contractEvaluate: vi.fn().mockResolvedValue({ evaluatedAt: 1, txHash: '0xevaluate' }),
  contractEvaluatorTimeout: vi.fn().mockResolvedValue('0xtimeout'),
  contractFinalizeVerdictTx: vi.fn().mockResolvedValue('0xfinalize'),
  contractRateTask: vi.fn().mockResolvedValue({ blockNumber: 1, hash: '0xrate' }),
  contractRefundExpired: vi.fn().mockResolvedValue('0xrefundexpired'),
  contractRejectSubmission: vi.fn().mockResolvedValue('0xreject'),
  contractUpdateTask: vi.fn().mockResolvedValue('0xupdate'),
  contractResolveDispute: vi
    .fn()
    .mockResolvedValue({ settledAt: null, settlement: null, txHash: '0xresolve' }),
  contractSelectWorker: vi.fn().mockResolvedValue('0xselect'),
  contractSubmitBid: vi.fn().mockResolvedValue('0xbid'),
  contractSubmitPitch: vi.fn().mockResolvedValue('0xpitch'),
  contractSubmitProof: vi.fn().mockResolvedValue('0xproof'),
  contractSubmitWork: vi.fn().mockResolvedValue('0xsubmitwork'),
  contractRegisterIdentityTx: vi.fn().mockResolvedValue('0xregister'),
  contractTransferWithAuthorization: vi.fn().mockResolvedValue('0xtransfer'),
  contractWithdrawDreamsRewards: vi.fn().mockResolvedValue('0xdreams'),
  blockNumberForTx: vi.fn().mockResolvedValue(1),
  blockTimestampForTx: vi.fn().mockResolvedValue(1),
  contractProjectSettlementForTx: vi.fn().mockResolvedValue({ settledAt: null, settlement: null }),
  resolveRegisteredAgentId: vi.fn().mockResolvedValue(1n),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
    DEFAULT_PLATFORM_FEE_BPS: 500,
  }),
}));

import * as contract from '../../../src/services/contract';
import { registerRelayedIntentHandlers } from '../../../src/services/intents/register';
import { getRelayedIntentBroadcaster } from '../../../src/services/relayed-intent-registry';
import type { RelayedIntent } from '../../../src/db/schema';

registerRelayedIntentHandlers();

const REQUESTER = '0x1111111111111111111111111111111111111111';
const WORKER = '0x2222222222222222222222222222222222222222';
const WORKER_B = '0x3333333333333333333333333333333333333333';
const EVALUATOR = '0x4444444444444444444444444444444444444444';
const MARKET = '0x0000000000000000000000000000000000000009';
const TASK_ID = `0x${'a'.repeat(64)}`;
const DELIVERABLE = `0x${'b'.repeat(64)}`;
const PITCH_HASH = `0x${'c'.repeat(64)}`;
const PROOF_HASH = `0x${'d'.repeat(64)}`;
const FEEDBACK_HASH = `0x${'e'.repeat(64)}`;
const EVIDENCE_HASH = `0x${'f'.repeat(64)}`;

/**
 * The stub behind one contract wrapper, as a plain mock.
 *
 * The table below indexes `contract` by a name that varies per case, so the union of every
 * wrapper's return type reaches `vi.mocked` and its `.mock` accessor disappears. Nothing here
 * depends on the signature -- the assertions are about recorded arguments -- so it is erased.
 */
function mockFor(name: keyof typeof contract) {
  return vi.mocked(contract[name] as unknown as (...args: unknown[]) => unknown);
}

function intent(operation: string, payload: unknown, payer: string | null = REQUESTER) {
  return {
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    id: `intent-${operation}`,
    operation,
    payer,
    payload,
    status: 'recorded',
  } as unknown as RelayedIntent;
}

/**
 * One case per operation: the payload as the router persists it, and the contract call the
 * router's own `send` made from the same request.
 *
 * Keeping the two side by side is the point of the table. A broadcaster's only job is to
 * reproduce the request path's call from the row, so the test that matters is an equality
 * between the two -- not an assertion that some call happened.
 */
const CASES: {
  args: unknown[];
  fn: keyof typeof contract;
  hash: string;
  operation: string;
  payer?: string | null;
  payload: Record<string, unknown>;
}[] = [
  {
    operation: 'tasks.cancel',
    payload: {
      contractAddress: MARKET,
      requester: REQUESTER,
      requesterAgentId: '7',
      taskId: TASK_ID,
    },
    fn: 'contractCancelTask',
    args: [TASK_ID, REQUESTER, 7n, MARKET],
    hash: '0xcancel',
  },
  {
    operation: 'tasks.rejectSubmission',
    payload: { requester: REQUESTER, taskId: TASK_ID, worker: WORKER },
    fn: 'contractRejectSubmission',
    args: [TASK_ID, WORKER, REQUESTER],
    hash: '0xreject',
  },
  {
    // Verifies: ADR-0054
    // The caller is the intent's own payer rather than a payload field: refundExpired is
    // permissionless (ADR-0026), so the sender is provenance, and one recorded copy of it beats
    // two that can disagree.
    operation: 'tasks.refundExpired',
    payload: { requesterAgentId: '7', taskId: TASK_ID },
    fn: 'contractRefundExpired',
    args: [TASK_ID, REQUESTER, 7n],
    hash: '0xrefundexpired',
  },
  {
    // Verifies: ADR-0054
    // currentReward is recorded, not re-read: it sizes the delta the forwarder pulls, and the
    // task row it came from is exactly what a confirmed first attempt moves.
    operation: 'tasks.update',
    payload: {
      contractAddress: MARKET,
      currentReward: '1000000',
      dbUpdate: { reward: '2500000' },
      newBidDeadline: '0',
      newExpiryTime: '1900000000',
      newPitchDeadline: '0',
      newReward: '2500000',
      taskId: TASK_ID,
    },
    fn: 'contractUpdateTask',
    args: [TASK_ID, REQUESTER, 2_500_000n, 1_900_000_000n, 0n, 0n, 1_000_000n, MARKET],
    hash: '0xupdate',
  },
  {
    operation: 'acceptance.accept',
    payload: {
      contractAddress: MARKET,
      deliverableHash: DELIVERABLE,
      isSelfAward: false,
      requester: REQUESTER,
      requesterAgentId: '11',
      taskId: TASK_ID,
      worker: WORKER,
    },
    fn: 'contractAcceptSubmission',
    args: [TASK_ID, REQUESTER, WORKER, DELIVERABLE, 11n, MARKET],
    hash: '0xaccept',
  },
  {
    operation: 'acceptance.acceptSubmissions',
    payload: {
      contractAddress: MARKET,
      deliverables: [DELIVERABLE, PROOF_HASH],
      requester: REQUESTER,
      requesterAgentId: null,
      taskId: TASK_ID,
      winners: [
        { share: 6000, worker: WORKER },
        { share: 4000, worker: WORKER_B },
      ],
    },
    fn: 'contractAcceptSubmissions',
    args: [
      TASK_ID,
      REQUESTER,
      [WORKER, WORKER_B],
      [6000, 4000],
      [DELIVERABLE, PROOF_HASH],
      0n,
      MARKET,
    ],
    hash: '0xacceptmany',
  },
  {
    operation: 'acceptance.rate',
    payload: {
      contractAddress: MARKET,
      feedbackHash: FEEDBACK_HASH,
      feedbackId: 'feedback-1',
      feedbackText: null,
      feedbackURI: 'https://api.example.test/api/feedback/feedback-1',
      fileContent: '{"createdAt":"2030-01-01T00:00:00.000Z"}',
      rating: 90,
      requesterAddress: REQUESTER,
      requesterAgentId: '11',
      taskId: TASK_ID,
      worker: WORKER,
      workerAgentId: '12',
    },
    fn: 'contractRateTask',
    args: [
      TASK_ID,
      REQUESTER,
      WORKER,
      90,
      12n,
      11n,
      'https://api.example.test/api/feedback/feedback-1',
      FEEDBACK_HASH,
      MARKET,
    ],
    hash: '0xrate',
  },
  {
    operation: 'bids.submit',
    payload: {
      bidId: 'bid-1',
      contractAddress: MARKET,
      price: '1500000',
      taskId: TASK_ID,
      workerAddress: WORKER,
    },
    fn: 'contractSubmitBid',
    args: [TASK_ID, WORKER, 1_500_000n, MARKET],
    hash: '0xbid',
  },
  {
    operation: 'bids.auctionAccept',
    payload: {
      acceptedAt: '2030-01-01T00:00:00.000Z',
      bidId: 'bid-2',
      contractAddress: MARKET,
      price: '2500000',
      taskId: TASK_ID,
      workerAddress: WORKER,
    },
    fn: 'contractAcceptAuction',
    args: [TASK_ID, WORKER, 2_500_000n, MARKET],
    hash: '0xauctionaccept',
  },
  {
    operation: 'pitches.submit',
    payload: {
      contractAddress: MARKET,
      estimatedDuration: null,
      pitchHash: PITCH_HASH,
      pitchId: 'pitch-1',
      pitchText: 'I will do it',
      signature: '0xsig',
      taskId: TASK_ID,
      workerAddress: WORKER,
    },
    fn: 'contractSubmitPitch',
    args: [TASK_ID, WORKER, PITCH_HASH, MARKET],
    hash: '0xpitch',
  },
  {
    operation: 'pitches.select',
    // The payer is deliberately not the requester: this route accepts payment from anyone and
    // authorises by requester signature, so a broadcaster reading `intent.payer` for the sender
    // would relay as the wrong address.
    payer: WORKER_B,
    payload: {
      contractAddress: MARKET,
      pitchId: 'pitch-1',
      requester: REQUESTER,
      taskId: TASK_ID,
      workerAddress: WORKER,
    },
    fn: 'contractSelectWorker',
    args: [TASK_ID, REQUESTER, WORKER, MARKET],
    hash: '0xselect',
  },
  {
    operation: 'proofs.submit',
    payload: {
      contractAddress: MARKET,
      metricValue: '42',
      proofData: 'raw proof',
      proofHash: PROOF_HASH,
      proofId: 'proof-1',
      proofType: 'benchmark-v1',
      signature: '0xsig',
      submissionId: 'submission-1',
      taskId: TASK_ID,
      workerAddress: WORKER,
    },
    fn: 'contractSubmitProof',
    // keccak256(toBytes('benchmark-v1')) -- a pure function of the recorded type string, so it
    // is the same bytes on every attempt.
    args: [
      TASK_ID,
      WORKER,
      PROOF_HASH,
      '0x1484ffeeea75fdb8bcb525fee04a66eb408f3614df8de6149d55255f5bee8f60',
      42n,
      MARKET,
    ],
    hash: '0xproof',
  },
  {
    operation: 'evaluations.evaluate',
    payer: EVALUATOR,
    payload: {
      awards: [{ amount: '900000', rank: 1, worker: WORKER }],
      confidence: 800,
      evidenceHash: EVIDENCE_HASH,
      mode: 'bounty',
      score: 950,
      taskId: TASK_ID,
      verdict: 'partial',
    },
    fn: 'contractEvaluate',
    args: [
      TASK_ID,
      EVALUATOR,
      2,
      950,
      800,
      EVIDENCE_HASH,
      [{ amount: 900_000n, rank: 1, worker: WORKER }],
    ],
    hash: '0xevaluate',
  },
  {
    operation: 'evaluations.appeal',
    payer: WORKER,
    payload: { taskId: TASK_ID },
    fn: 'contractAppeal',
    args: [TASK_ID, WORKER],
    hash: '0xappeal',
  },
  {
    operation: 'evaluations.resolveDispute',
    payer: EVALUATOR,
    payload: {
      awards: [{ amount: '800000', rank: 1, worker: WORKER }],
      firstAwardWorker: WORKER,
      taskId: TASK_ID,
      verdict: 'approve',
    },
    fn: 'contractResolveDispute',
    args: [TASK_ID, EVALUATOR, 0, [{ amount: 800_000n, rank: 1, worker: WORKER }]],
    hash: '0xresolve',
  },
  {
    operation: 'evaluations.evaluatorTimeout',
    payload: { taskId: TASK_ID },
    fn: 'contractEvaluatorTimeout',
    args: [TASK_ID, REQUESTER],
    hash: '0xtimeout',
  },
];

describe('rebroadcasting a relayed write from its persisted payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const testCase of CASES) {
    describe(testCase.operation, () => {
      const broadcast = getRelayedIntentBroadcaster(testCase.operation);
      const row = () => intent(testCase.operation, testCase.payload, testCase.payer ?? REQUESTER);

      // Verifies: ADR-0050
      it('makes the same call the request path made', async () => {
        const hash = await broadcast!({ db: {} as never, intent: row() });

        expect(mockFor(testCase.fn)).toHaveBeenCalledWith(...testCase.args);
        // The registry persists whatever comes back as the intent's tx hash, so a broadcaster
        // returning a result object instead of a hash would poison the rebroadcast sweep's
        // "did this reach the chain" check.
        expect(hash).toBe(testCase.hash);
      });

      // Verifies: ADR-0050
      it('produces identical calldata on a second attempt', async () => {
        // The property retry depends on: the payload is replayed verbatim, so "did this land?"
        // refers to one call and one call only. A broadcaster that consulted the clock, a
        // random source, or the database would differ between these two and the deadline would
        // stop being a bound on anything (ADR-0050 point 7).
        await broadcast!({ db: {} as never, intent: row() });
        await broadcast!({ db: {} as never, intent: row() });

        const calls = mockFor(testCase.fn).mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual(calls[1]);
      });

      // Verifies: ADR-0050
      it('reads only the intent row, never the database', async () => {
        // A broadcaster given a db that throws on any access still has to work. Re-reading at
        // broadcast time would resolve against a world that has moved on -- the acceptance
        // deliverable is the sharp case, where the newest unrejected submission is a different
        // worker's work by then.
        const hostileDb = new Proxy(
          {},
          {
            get() {
              throw new Error('a broadcaster must not read the database');
            },
          }
        );

        await expect(broadcast!({ db: hostileDb as never, intent: row() })).resolves.toBe(
          testCase.hash
        );
      });
    });
  }
});

describe('a verdict outside the vocabulary', () => {
  // Verifies: ADR-0047, ADR-0050
  const cases = [
    { fn: 'contractEvaluate', operation: 'evaluations.evaluate', payer: EVALUATOR },
    { fn: 'contractResolveDispute', operation: 'evaluations.resolveDispute', payer: EVALUATOR },
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const testCase of cases) {
    it(`refuses to send anything at all from ${testCase.operation}`, async () => {
      // Both sites used to fall back to `?? 0`, and 0 is APPROVE -- so a verdict nobody can
      // interpret did not fail, it paid the awards out. Money must not move on a value we
      // could not read.
      const broadcast = getRelayedIntentBroadcaster(testCase.operation)!;
      const payload = {
        awards: [{ amount: '900000', rank: 1, worker: WORKER }],
        confidence: 800,
        evidenceHash: EVIDENCE_HASH,
        firstAwardWorker: WORKER,
        mode: 'bounty',
        score: 950,
        taskId: TASK_ID,
        verdict: 'approved',
      };

      await expect(
        broadcast({ db: {} as never, intent: intent(testCase.operation, payload, testCase.payer) })
      ).rejects.toThrow(/unknown verdict "approved"/);
      expect(mockFor(testCase.fn)).not.toHaveBeenCalled();
    });
  }

  it('is classified deterministic so the reconciler stops instead of retrying forever', async () => {
    // This runs on the broadcast path, which a reconciler pass reaches with no caller waiting.
    // `classifyRelayFailure` defaults to transient, so a plain Error would put a payload that
    // can never succeed back in the queue on every pass, forever -- ADR-0047's unbounded loop.
    // Stated as deterministic, the intent reaches a visible terminal state instead.
    const { classifyRelayFailure } = await import('../../../src/lib/relay-failure');
    const broadcast = getRelayedIntentBroadcaster('evaluations.resolveDispute')!;
    const error = await broadcast({
      db: {} as never,
      intent: intent(
        'evaluations.resolveDispute',
        { awards: [], firstAwardWorker: WORKER, taskId: TASK_ID, verdict: '' },
        EVALUATOR
      ),
    }).catch((thrown: unknown) => thrown);

    expect(classifyRelayFailure(error)).toBe('deterministic');
  });
});

describe('the relay envelope a rebroadcast replays', () => {
  // Verifies: ADR-0050
  it('is bound around the broadcaster by the dispatch path, not minted inside it', async () => {
    // The deadline is the retry policy's only real bound, and it only bounds anything because
    // it is fixed at record time. `dispatchRelayedIntent` binds the stored envelope around the
    // broadcaster; the broadcasters themselves are envelope-agnostic, which is what keeps the
    // rule in one place rather than in every operation.
    const { currentRelayEnvelope, withRelayEnvelope } =
      await import('../../../src/services/relay-envelope');
    const stored = { receiptNonce: `0x${'cd'.repeat(32)}` as const, validBefore: 1_900_000_000n };

    const broadcast = getRelayedIntentBroadcaster('tasks.cancel')!;
    let seen: unknown;
    await withRelayEnvelope(stored, async () => {
      await broadcast({
        db: {} as never,
        intent: intent('tasks.cancel', {
          contractAddress: MARKET,
          requester: REQUESTER,
          requesterAgentId: null,
          taskId: TASK_ID,
        }),
      });
      seen = currentRelayEnvelope();
    });

    expect(seen).toEqual(stored);
  });
});
