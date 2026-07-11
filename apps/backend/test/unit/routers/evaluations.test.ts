import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

const EVALUATED_AT = 1_800_000_000;

vi.mock('../../../src/services/contract', () => ({
  contractEvaluate: vi.fn().mockResolvedValue({
    txHash: '0xevaluatetx',
    evaluatedAt: 1_800_000_000,
  }),
  contractEvaluatorTimeout: vi.fn().mockResolvedValue('0xevaluatortimeout'),
  contractFinalizeVerdict: vi.fn().mockResolvedValue('0xfinalizetx'),
  contractResolveDispute: vi.fn().mockResolvedValue('0xresolvetx'),
}));

import { evaluationsRouter } from '../../../src/routers/evaluations.router';
import {
  contractEvaluate,
  contractEvaluatorTimeout,
  contractFinalizeVerdict,
  contractResolveDispute,
} from '../../../src/services/contract';

const REQUESTER = '0xRequester0000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const EVALUATOR = '0xEvaluator000000000000000000000000000001';
const WORKER = '0xWorker000000000000000000000000000000001';

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
  });

  describe('evaluate', () => {
    const evalInput = { taskId: TASK_ID, verdict: 'approve' as const };

    it('calls contractEvaluate and returns txHash on happy path', async () => {
      const ctx = createMockCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));
      ctx.db.update.mockReturnValueOnce(makeChain());

      const result = await evaluationsRouter.createCaller(ctx).evaluate(evalInput);

      expect(contractEvaluate).toHaveBeenCalledOnce();
      expect(result).toEqual({ txHash: '0xevaluatetx' });
    });

    it('updates task status to appealing with verdict fields', async () => {
      const ctx = createMockCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));
      const updateChain = makeChain();
      ctx.db.update.mockReturnValueOnce(updateChain);

      await evaluationsRouter.createCaller(ctx).evaluate(evalInput);

      expect(ctx.db.update).toHaveBeenCalledOnce();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'appealing', verdictType: 'APPROVE' })
      );
    });

    it('rejects when caller is not the assigned evaluator', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluate(evalInput)
      ).rejects.toThrow('Only the assigned evaluator can evaluate this task');
    });

    it('rejects when task has no evaluator assigned', async () => {
      const ctx = createMockCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ evaluator: null })]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluate(evalInput)
      ).rejects.toThrow('Only the assigned evaluator can evaluate this task');
    });

    it('rejects when task is not in an evaluatable state', async () => {
      const ctx = createMockCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'open', mode: 'claim' })]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluate(evalInput)
      ).rejects.toThrow('Task is not in an evaluatable state');
    });

    it('allows evaluation when bounty/benchmark task is open', async () => {
      const ctx = createMockCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ status: 'open', mode: 'bounty' })])
      );
      ctx.db.update.mockReturnValueOnce(makeChain());

      const result = await evaluationsRouter.createCaller(ctx).evaluate(evalInput);
      expect(result).toEqual({ txHash: '0xevaluatetx' });
    });

    it('persists the lead award worker so a contest verdict can be appealed', async () => {
      const ctx = createMockCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ status: 'open', mode: 'bounty', worker: null })])
      );
      const updateChain = makeChain();
      ctx.db.update.mockReturnValueOnce(updateChain);

      await evaluationsRouter.createCaller(ctx).evaluate({
        ...evalInput,
        awards: [{ worker: WORKER, amount: '1000000', rank: 1 }],
      });

      expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ worker: WORKER }));
    });

    it('mirrors the onchain expiry extension through the appeal deadline', async () => {
      const ctx = createMockCtx(EVALUATOR);
      const updateChain = makeChain();
      const originalExpiry = new Date(Date.now() + 1000);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ expiryTime: originalExpiry })]));
      ctx.db.update.mockReturnValueOnce(updateChain);

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
      const ctx = createMockCtx(EVALUATOR);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluate(evalInput)
      ).rejects.toThrow('Task not found');
    });
  });

  describe('finalizeVerdict', () => {
    it('rejects when task is not in appealing state', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'review' })]));

      await expect(
        evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID })
      ).rejects.toThrow('Task is not in Appealing state');
    });

    it('finalizes verdict when task is appealing and appeal window has passed', async () => {
      const ctx = createMockCtx(REQUESTER);
      const expiredDeadline = new Date(Date.now() - 1000);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ status: 'appealing', verdictType: 'APPROVE', appealDeadline: expiredDeadline })])
      );
      ctx.db.update.mockReturnValueOnce(makeChain());

      const result = await evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID });

      expect(contractFinalizeVerdict).toHaveBeenCalledWith(TASK_ID);
      expect(result).toEqual({ txHash: '0xfinalizetx' });
    });

    it('mirrors evaluator cleanup when a rejected verdict reopens the task', async () => {
      const ctx = createMockCtx(REQUESTER);
      const updateChain = makeChain();
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            status: 'appealing',
            verdictType: 'REJECT',
            appealDeadline: new Date(Date.now() - 1000),
            worker: WORKER,
          }),
        ])
      );
      ctx.db.update.mockReturnValueOnce(updateChain);

      await evaluationsRouter.createCaller(ctx).finalizeVerdict({ taskId: TASK_ID });

      expect(updateChain.set).toHaveBeenCalledWith({
        status: 'open',
        worker: null,
        evaluator: null,
        evaluatorStake: '0',
        evaluationWindow: null,
        appealWindow: null,
        evaluatorDeadline: null,
        appealDeadline: null,
      });
    });
  });

  describe('resolveDispute', () => {
    it('persists the lead award worker selected onchain', async () => {
      const ctx = createMockCtx(REQUESTER);
      const updateChain = makeChain();
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({ status: 'disputed', disputeResolver: REQUESTER, worker: EVALUATOR }),
        ])
      );
      ctx.db.update.mockReturnValueOnce(updateChain);

      const result = await evaluationsRouter.createCaller(ctx).resolveDispute({
        taskId: TASK_ID,
        verdict: 'approve',
        awards: [{ worker: WORKER, amount: '1000000', rank: 1 }],
      });

      expect(contractResolveDispute).toHaveBeenCalledOnce();
      expect(updateChain.set).toHaveBeenCalledWith({ status: 'completed', worker: WORKER });
      expect(result).toEqual({ txHash: '0xresolvetx' });
    });
  });

  describe('evaluatorTimeout', () => {
    const expiredDeadline = new Date(Date.now() - 1000);

    it('calls contractEvaluatorTimeout and returns txHash', async () => {
      const ctx = createMockCtx(REQUESTER);
      const updateChain = makeChain();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ evaluatorDeadline: expiredDeadline })])
      );
      ctx.db.update.mockReturnValueOnce(updateChain);

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
      const ctx = createMockCtx(REQUESTER);
      const futureDeadline = new Date(Date.now() + 60000);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ evaluatorDeadline: futureDeadline })])
      );

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Evaluator deadline has not yet passed');
    });

    it('rejects when evaluator deadline is null', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ evaluatorDeadline: null })])
      );

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Evaluator deadline has not yet passed');
    });

    it('rejects when task is not in review state', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'open' })]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Task is not in Review state');
    });

    it('rejects when caller is not the requester', async () => {
      const ctx = createMockCtx('0xOtherAddress0000000000000000000000000001');
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Only the requester can trigger evaluator timeout');
    });

    it('rejects when task is not found', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      await expect(
        evaluationsRouter.createCaller(ctx).evaluatorTimeout({ taskId: TASK_ID })
      ).rejects.toThrow('Task not found');
    });
  });
});
