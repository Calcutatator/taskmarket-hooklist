import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIntentCtx, createMockCtx, makeChain } from '../helpers';

const EVALUATED_AT = 1_800_000_000;

vi.mock('../../../src/services/contract', () => ({
  contractEvaluate: vi.fn().mockResolvedValue({
    txHash: '0xevaluatetx',
    evaluatedAt: 1_800_000_000,
  }),
  contractAppeal: vi.fn().mockResolvedValue('0xappealtx'),
  contractGetContestAppealState: vi.fn(),
  contractEvaluatorTimeout: vi.fn().mockResolvedValue('0xevaluatortimeout'),
  // Completion handlers re-derive from the confirmed transaction rather than from the intent
  // payload, which predates it (ADR-0045).
  blockTimestampForTx: vi.fn().mockResolvedValue(1_800_000_000),
  contractProjectSettlementForTx: vi.fn().mockResolvedValue({ settlement: null, settledAt: null }),
  contractFinalizeVerdictTx: vi.fn().mockResolvedValue('0xfinalizetx'),
  contractResolveDispute: vi.fn().mockResolvedValue({
    txHash: '0xresolvetx',
    settlement: null,
    settledAt: null,
  }),
}));

vi.mock('../../../src/services/settlement-recorder', () => ({
  recordTaskSettlement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({ CHAIN_ID: 84532 }),
}));

import { evaluationsRouter } from '../../../src/routers/evaluations.router';
import { submissions, tasks } from '../../../src/db/schema';
import { contractProjectSettlementForTx } from '../../../src/services/contract';
import {
  contractAppeal,
  contractEvaluate,
  contractEvaluatorTimeout,
  contractFinalizeVerdictTx,
  contractGetContestAppealState,
  contractResolveDispute,
} from '../../../src/services/contract';
import { recordTaskSettlement } from '../../../src/services/settlement-recorder';

const SAMPLE_SETTLEMENT = {
  awards: [
    {
      blockNumber: 100n,
      grossAmount: 1000000n,
      isPrimary: true,
      logIndex: 0,
      platformFee: 50000n,
      rank: 1,
      workerAddress: '0xWorker000000000000000000000000000000001',
      workerPayment: 950000n,
    },
  ],
  blockNumber: 100n,
  primaryWorker: '0xWorker000000000000000000000000000000001',
  taskId: '0xtask0000000000000000000000000000000001',
  transactionHash: '0xdisputetx',
};

const REQUESTER = '0xRequester0000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const EVALUATOR = '0xEvaluator000000000000000000000000000001';
const WORKER = '0xWorker000000000000000000000000000000001';
const OTHER_WORKER = '0xWorker000000000000000000000000000000002';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// The contract rejects disputeResolver == requester (self-assignment guard), so a task
// whose resolver is its own requester is unreachable on chain -- resolveDispute fixtures
// use a genuinely third address rather than borrowing the requester's.
const RESOLVER = '0xResolver00000000000000000000000000000001';

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    requester: REQUESTER,
    status: 'review',
    evaluator: EVALUATOR,
    evaluatorStake: '1000000',
    appealWindow: 86400,
    expiryTime: new Date(Date.now() + 1000),
    mode: 'claim',
    ...overrides,
  };
}

describe('evaluations router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(contractGetContestAppealState).mockResolvedValue({
      claimedWorker: ZERO_ADDRESS,
      hasSubmission: false,
    });
  });

  describe('evaluate', () => {
    const evalInput = { taskId: TASK_ID, verdict: 'approve' as const };

    it('calls contractEvaluate and returns txHash on happy path', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([makeTask()]));

      const result = await evaluationsRouter.createCaller(ctx).evaluate(evalInput);

      expect(contractEvaluate).toHaveBeenCalledOnce();
      expect(result).toEqual({ txHash: '0xevaluatetx' });
    });

    it('updates task status to appealing with verdict fields', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([makeTask()]));
      const updateChain = ctx.updateChain(tasks);

      await evaluationsRouter.createCaller(ctx).evaluate(evalInput);

      expect(updateChain.set).toHaveBeenCalledOnce();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'appealing', verdictType: 'APPROVE' })
      );
    });

    it('rejects when caller is not the assigned evaluator', async () => {
      const ctx = createIntentCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await expect(evaluationsRouter.createCaller(ctx).evaluate(evalInput)).rejects.toThrow(
        'Only the assigned evaluator can evaluate this task'
      );
    });

    it('rejects when task has no evaluator assigned', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ evaluator: null })]));

      await expect(evaluationsRouter.createCaller(ctx).evaluate(evalInput)).rejects.toThrow(
        'Only the assigned evaluator can evaluate this task'
      );
    });

    it('rejects when task is not in an evaluatable state', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'open', mode: 'claim' })]));

      await expect(evaluationsRouter.createCaller(ctx).evaluate(evalInput)).rejects.toThrow(
        'Task is not in an evaluatable state'
      );
    });

    it('allows evaluation when bounty/benchmark task is open', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ status: 'open', mode: 'bounty' })]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([makeTask({ status: 'open', mode: 'bounty' })]));

      const result = await evaluationsRouter.createCaller(ctx).evaluate(evalInput);
      expect(result).toEqual({ txHash: '0xevaluatetx' });
    });

    it('persists the lead award worker so a contest verdict can be appealed', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      const openBounty = makeTask({ status: 'open', mode: 'bounty', claimedBy: null });
      ctx.db.select
        .mockReturnValueOnce(makeChain([openBounty]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([openBounty]));
      const updateChain = ctx.updateChain(tasks);

      await evaluationsRouter.createCaller(ctx).evaluate({
        ...evalInput,
        awards: [{ worker: WORKER, amount: '1000000', rank: 1 }],
      });

      expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ claimedBy: WORKER }));
    });

    it('keeps the assigned worker when a locked-worker mode verdict names another address', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      const other = '0xOther0000000000000000000000000000000001';
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ claimedBy: WORKER })]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([makeTask({ claimedBy: WORKER })]));
      const updateChain = ctx.updateChain(tasks);

      await evaluationsRouter.createCaller(ctx).evaluate({
        ...evalInput,
        awards: [{ worker: other, amount: '1000000', rank: 1 }],
      });

      expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ claimedBy: WORKER }));
    });

    it('mirrors the onchain expiry extension through the appeal deadline', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      const updateChain = ctx.updateChain(tasks);
      const originalExpiry = new Date((EVALUATED_AT - 3600) * 1000);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ expiryTime: originalExpiry })]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([makeTask({ expiryTime: originalExpiry })]));

      await evaluationsRouter.createCaller(ctx).evaluate(evalInput);

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          expiryTime: expect.any(Date),
          appealDeadline: expect.any(Date),
        })
      );
      const update = updateChain.set.mock.calls[0][0] as {
        expiryTime: Date;
        appealDeadline: Date;
      };
      expect(update.expiryTime).toEqual(update.appealDeadline);
      expect(update.expiryTime.getTime()).toBeGreaterThan(originalExpiry.getTime());
      expect(update.appealDeadline).toEqual(new Date((EVALUATED_AT + 86400) * 1000));
    });

    it('rejects when task is not found', async () => {
      const ctx = createIntentCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      await expect(evaluationsRouter.createCaller(ctx).evaluate(evalInput)).rejects.toThrow(
        'Task not found'
      );
    });
  });

  describe('appeal', () => {
    it('allows a contest submitter to appeal when no single worker is claimed', async () => {
      vi.mocked(contractGetContestAppealState).mockResolvedValueOnce({
        claimedWorker: ZERO_ADDRESS,
        hasSubmission: true,
      });
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            mode: 'bounty',
            status: 'appealing',
            claimedBy: null,
            appealDeadline: new Date(Date.now() + 60_000),
          }),
        ])
      );

      const result = await evaluationsRouter.createCaller(ctx).appeal({ taskId: TASK_ID });

      expect(contractAppeal).toHaveBeenCalledWith(TASK_ID, WORKER);
      expect(result).toEqual({ txHash: '0xappealtx' });
    });

    it('rejects a wallet that did not submit to the contest', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            mode: 'benchmark',
            status: 'appealing',
            claimedBy: null,
            appealDeadline: new Date(Date.now() + 60_000),
          }),
        ])
      );

      await expect(evaluationsRouter.createCaller(ctx).appeal({ taskId: TASK_ID })).rejects.toThrow(
        'Only a task submitter can appeal'
      );
    });

    it('rejects a recovered losing submitter when another worker was awarded onchain', async () => {
      vi.mocked(contractGetContestAppealState).mockResolvedValueOnce({
        claimedWorker: OTHER_WORKER as `0x${string}`,
        hasSubmission: true,
      });
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'bounty', status: 'appealing', claimedBy: null })])
      );

      await expect(evaluationsRouter.createCaller(ctx).appeal({ taskId: TASK_ID })).rejects.toThrow(
        'Only the task worker can appeal'
      );
      expect(contractAppeal).not.toHaveBeenCalled();
    });

    it('allows the recovered awarded worker even without a submission row', async () => {
      vi.mocked(contractGetContestAppealState).mockResolvedValueOnce({
        claimedWorker: WORKER as `0x${string}`,
        hasSubmission: false,
      });
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'benchmark', status: 'appealing', claimedBy: null })])
      );

      await expect(
        evaluationsRouter.createCaller(ctx).appeal({ taskId: TASK_ID })
      ).resolves.toEqual({ txHash: '0xappealtx' });
      // Asserted on what was read, not how many reads happened. This test's claim is that the
      // recovered worker comes from the chain (contractGetContestAppealState) and never from a
      // submission row -- and a count cannot say that, because the relayed intent's own
      // bookkeeping also reads (ADR-0045). A count would pass just as happily if a submissions
      // read were added and an intent read removed.
      const tablesRead = (ctx.db.select.mock.results as { value?: unknown }[])
        .map((result) => (result.value as { from?: { mock?: { calls?: unknown[][] } } })?.from)
        .map((from) => from?.mock?.calls?.[0]?.[0])
        .filter(Boolean);

      expect(tablesRead).toContain(tasks);
      expect(tablesRead).not.toContain(submissions);
    });
  });

  describe('finalizeVerdict', () => {
    it('rejects when task is not in appealing state', async () => {
      const ctx = createIntentCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'review' })]));

      await expect(
        evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID })
      ).rejects.toThrow('Task is not in Appealing state');
    });

    it('finalizes verdict when task is appealing and appeal window has passed', async () => {
      const ctx = createIntentCtx(REQUESTER);
      const expiredDeadline = new Date(Date.now() - 1000);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            status: 'appealing',
            verdictType: 'APPROVE',
            appealDeadline: expiredDeadline,
          }),
        ])
      );

      const result = await evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID });

      expect(contractFinalizeVerdictTx).toHaveBeenCalledWith(TASK_ID);
      expect(result).toEqual({ txHash: '0xfinalizetx' });
    });

    it('mirrors evaluator cleanup when a rejected verdict terminates the task', async () => {
      const ctx = createIntentCtx(REQUESTER);
      const updateChain = ctx.updateChain(tasks);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            status: 'appealing',
            verdictType: 'REJECT',
            appealDeadline: new Date(Date.now() - 1000),
            claimedBy: WORKER,
          }),
        ])
      );
      // Not mockReturnValueOnce: the first UPDATE of a relayed write is now the intent's
      // broadcast claim (ADR-0052), so hijacking "the first one" would starve the claim and
      // hand this chain to it. The helper routes by table, which is what this wants anyway.

      await evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID });

      expect(updateChain.set).toHaveBeenCalledWith({
        appealDeadline: null,
        appealWindow: null,
        claimedBy: null,
        evaluationWindow: null,
        evaluator: null,
        evaluatorDeadline: null,
        evaluatorStake: '0',
        status: 'cancelled',
      });
    });

    it('records task_awards synchronously instead of relying on the async indexer', async () => {
      const ctx = createIntentCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            status: 'appealing',
            verdictType: 'APPROVE',
            appealDeadline: new Date(Date.now() - 1000),
          }),
        ])
      );
      // The settlement is projected from the confirmed hash, not returned by the send: the
      // completion may run in a process that never made the call (ADR-0045).
      vi.mocked(contractProjectSettlementForTx).mockResolvedValueOnce({
        settlement: SAMPLE_SETTLEMENT,
        settledAt: 1_800_000_000,
      });

      await evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID });

      expect(contractProjectSettlementForTx).toHaveBeenCalledWith(TASK_ID, '0xfinalizetx');
      expect(recordTaskSettlement).toHaveBeenCalledWith(ctx.db, {
        chainId: 84532,
        settledAt: new Date(1_800_000_000 * 1000),
        settlement: SAMPLE_SETTLEMENT,
      });
      // No separate raw tasks.update -- recordTaskSettlement's own transaction
      // is the sole writer of status/awards for this path.
      expect(ctx.updateChain(tasks).set).not.toHaveBeenCalled();
    });

    // Verifies: ADR-0045
    it('records an intent even though anyone may call it', async () => {
      const ctx = createIntentCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            status: 'appealing',
            verdictType: 'APPROVE',
            appealDeadline: new Date(Date.now() - 1000),
          }),
        ])
      );

      await evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID });

      // Permissionlessness changes nothing here: an intent records what the server relayed,
      // not who asked for it, and the settlement still has to reach the database when the
      // receipt outlives the request.
      const intent = ctx.intents[0]!;
      expect(intent.operation).toBe('evaluations.finalizeVerdict');
      expect(intent.paymentTxHash).toBeNull();
      expect(intent.payer).toBeNull();
      expect((intent.payload as { rejected: boolean }).rejected).toBe(false);
      expect(intent.status).toBe('completed');
    });

    /**
     * Verifies: ADR-0059
     *
     * The endpoint stays permissionless either way -- both calls below succeed, and neither
     * caller had to prove anything to make the write. What identifying yourself buys is the
     * ability to ask about it afterwards, since `intents.get` is scoped to the recorded
     * initiator and a row with none is readable by nobody.
     */
    describe('who the intent records as having initiated it', () => {
      const appealingTask = () =>
        makeTask({
          status: 'appealing',
          verdictType: 'APPROVE',
          appealDeadline: new Date(Date.now() - 1000),
        });

      it('records the caller when they supplied the read-auth headers', async () => {
        const ctx = createIntentCtx(undefined, { address: WORKER.toLowerCase() });
        ctx.db.select.mockReturnValueOnce(makeChain([appealingTask()]));

        await evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID });

        expect(ctx.intents[0]!.payer).toBe(WORKER.toLowerCase());
      });

      it('records nobody when they did not', async () => {
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(makeChain([appealingTask()]));

        // Not an error and not a challenge: an anonymous caller is served exactly as before,
        // and simply leaves no address for the read surface to compare against later.
        const result = await evaluationsRouter
          .createCaller(ctx)
          .finalizeVerdict({ taskId: TASK_ID });

        expect(result).toEqual({ txHash: '0xfinalizetx' });
        expect(ctx.intents[0]!.payer).toBeNull();
      });
    });
  });

  describe('resolveDispute', () => {
    it('persists the lead award worker selected onchain', async () => {
      const ctx = createIntentCtx(RESOLVER);
      const updateChain = ctx.updateChain(tasks);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({ status: 'disputed', disputeResolver: RESOLVER, claimedBy: EVALUATOR }),
        ])
      );
      // Not mockReturnValueOnce: the first UPDATE of a relayed write is now the intent's
      // broadcast claim (ADR-0052), so hijacking "the first one" would starve the claim and
      // hand this chain to it. The helper routes by table, which is what this wants anyway.

      const result = await evaluationsRouter.createCaller(ctx).resolveDispute({
        taskId: TASK_ID,
        verdict: 'approve',
        awards: [{ worker: WORKER, amount: '1000000', rank: 1 }],
      });

      expect(contractResolveDispute).toHaveBeenCalledOnce();
      expect(updateChain.set).toHaveBeenCalledWith({ status: 'completed', claimedBy: WORKER });
      expect(result).toEqual({ txHash: '0xresolvetx' });
    });

    it('records task_awards synchronously instead of relying on the async indexer', async () => {
      const ctx = createIntentCtx(RESOLVER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({ status: 'disputed', disputeResolver: RESOLVER, claimedBy: EVALUATOR }),
        ])
      );
      // The settlement is projected from the confirmed transaction's own logs by the
      // completion handler, not returned to the request (ADR-0045).
      vi.mocked(contractProjectSettlementForTx).mockResolvedValueOnce({
        settlement: SAMPLE_SETTLEMENT,
        settledAt: 1_800_000_000,
      });

      await evaluationsRouter.createCaller(ctx).resolveDispute({
        taskId: TASK_ID,
        verdict: 'approve',
        awards: [{ worker: WORKER, amount: '1000000', rank: 1 }],
      });

      expect(recordTaskSettlement).toHaveBeenCalledWith(ctx.db, {
        chainId: 84532,
        settledAt: new Date(1_800_000_000 * 1000),
        settlement: SAMPLE_SETTLEMENT,
      });
      // No separate raw tasks.update -- recordTaskSettlement's own transaction
      // is the sole writer of status/awards for this path.
      expect(ctx.updateChain(tasks).set).not.toHaveBeenCalled();
    });
  });

  describe('evaluatorTimeout', () => {
    const expiredDeadline = new Date(Date.now() - 1000);

    it('calls contractEvaluatorTimeout and returns txHash', async () => {
      const ctx = createIntentCtx(REQUESTER);
      const updateChain = ctx.updateChain(tasks);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ evaluatorDeadline: expiredDeadline })])
      );
      // Not mockReturnValueOnce: the first UPDATE of a relayed write is now the intent's
      // broadcast claim (ADR-0052), so hijacking "the first one" would starve the claim and
      // hand this chain to it. The helper routes by table, which is what this wants anyway.

      const result = await evaluationsRouter.createCaller(ctx).evaluatorTimeout({
        taskId: TASK_ID,
      });

      expect(contractEvaluatorTimeout).toHaveBeenCalledWith(TASK_ID, REQUESTER);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ evaluator: null, evaluatorDeadline: null })
      );
      expect(result).toEqual({ txHash: '0xevaluatortimeout' });
    });

    it('rejects when evaluator deadline has not passed', async () => {
      const ctx = createIntentCtx(REQUESTER);
      const futureDeadline = new Date(Date.now() + 60000);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ evaluatorDeadline: futureDeadline })])
      );

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Evaluator deadline has not yet passed');
    });

    it('rejects when evaluator deadline is null', async () => {
      const ctx = createIntentCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ evaluatorDeadline: null })]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Evaluator deadline has not yet passed');
    });

    it('rejects when task is not in review state', async () => {
      const ctx = createIntentCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'open' })]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Task is not in Review state');
    });

    it('rejects when caller is not the requester', async () => {
      const ctx = createIntentCtx('0xOtherAddress0000000000000000000000000001');
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Only the requester can trigger evaluator timeout');
    });

    it('rejects when task is not found', async () => {
      const ctx = createIntentCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Task not found');
    });
  });
});
