import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractSelectWorker: vi.fn().mockResolvedValue('0xselecttx'),
}));

import { proposalsRouter } from '../../../src/routers/proposals.router';
import { contractSelectWorker } from '../../../src/services/contract';

const REQUESTER = '0xRequester0000000000000000000000000000001';
const WORKER = '0xWorker0000000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const PROPOSAL_ID = '00000000-0000-0000-0000-000000000001';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: REQUESTER,
    requesterPubkey: REQUESTER,
    description: 'Proposal task',
    reward: '1000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    worker: null,
    rating: null,
    mode: 'proposal',
    stakeRequired: 0,
    stakeBps: 0,
    proposalDeadline: new Date(Date.now() + 3600000),
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
    ...overrides,
  };
}

describe('proposals router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submit', () => {
    const submitInput = {
      taskId: TASK_ID,
      workerAddress: WORKER,
      proposalText: 'My proposal',
      signature: '0xsig',
    };

    it('throws when task not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not proposal', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'race' })]));

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Not a Proposal task');
    });

    it('throws when task is not open', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'worker_selected' })]));

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not open for proposals');
    });

    it('throws when proposal deadline has passed', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ proposalDeadline: new Date(Date.now() - 1000) })])
      );

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Proposal deadline has passed');
    });

    it('throws when worker already submitted a proposal', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        // existing proposal check returns a duplicate
        .mockReturnValueOnce(makeChain([{ id: 'existing-proposal', workerAddress: WORKER }]));

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow(
        'Worker has already submitted a proposal'
      );
    });

    it('inserts proposal and returns proposalId on happy path', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([])); // no duplicate

      const caller = proposalsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(typeof result.proposalId).toBe('string');
      expect(ctx.db.insert).toHaveBeenCalledOnce();
    });
  });

  describe('listByTask', () => {
    it('returns proposals with worker stats', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            {
              id: PROPOSAL_ID,
              taskId: TASK_ID,
              workerAddress: WORKER,
              proposalText: 'My proposal',
              estimatedDuration: null,
              status: 'pending',
              submittedAt: new Date(),
            },
          ])
        )
        // agent lookup
        .mockReturnValueOnce(
          makeChain([
            {
              address: WORKER,
              completedTasks: 5,
              ratedTasks: 3,
              totalStars: 12,
              totalEarnings: '5000000',
              updatedAt: new Date(),
            },
          ])
        );

      const caller = proposalsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(1);
      expect(result[0].workerStats).toBeDefined();
      expect(result[0].workerStats!.completedTasks).toBe(5);
    });

    it('returns proposals with no workerStats when agent not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            {
              id: PROPOSAL_ID,
              taskId: TASK_ID,
              workerAddress: WORKER,
              proposalText: 'My proposal',
              estimatedDuration: null,
              status: 'pending',
              submittedAt: new Date(),
            },
          ])
        )
        .mockReturnValueOnce(makeChain([])); // no agent

      const caller = proposalsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result[0].workerStats).toBeUndefined();
    });
  });

  describe('select', () => {
    const selectInput = {
      taskId: TASK_ID,
      workerAddress: WORKER,
      proposalId: PROPOSAL_ID,
      signature: '0xsig',
    };

    it('throws when payer does not match requester', async () => {
      const ctx = createMockCtx('0xDifferentPayer000000000000000000000001');
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.select(selectInput)).rejects.toThrow(
        'Only the task requester can select a worker'
      );
    });

    it('throws when task is not found', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.select(selectInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not proposal', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'contest' })]));

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.select(selectInput)).rejects.toThrow('Not a Proposal task');
    });

    it('throws when task is not open', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'worker_selected' })]));

      const caller = proposalsRouter.createCaller(ctx);
      await expect(caller.select(selectInput)).rejects.toThrow('Task not open');
    });

    it('calls contractSelectWorker and updates 3 DB rows on happy path', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proposalsRouter.createCaller(ctx);
      const result = await caller.select(selectInput);

      expect(result.success).toBe(true);
      expect(contractSelectWorker).toHaveBeenCalledOnce();
      // selected proposal, rejected others, task status update = 3 update calls
      expect(ctx.db.update).toHaveBeenCalledTimes(3);
    });
  });
});
