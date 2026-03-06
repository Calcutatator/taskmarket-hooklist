import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractAcceptSubmission: vi.fn().mockResolvedValue('0xaccepttx'),
  contractRateTask: vi.fn().mockResolvedValue({ hash: '0xratetx', blockNumber: 100 }),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    BACKEND_URL: 'http://localhost:3000',
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: '0xD17485087c2d31bf5562ACf0C5295111982A1CBF',
    ERC8004_IDENTITY_REGISTRY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  }),
}));

import { acceptanceRouter } from '../../../src/routers/acceptance.router';
import { contractAcceptSubmission, contractRateTask } from '../../../src/services/contract';

const REQUESTER = '0xRequester0000000000000000000000000000001';
const WORKER = '0xWorker0000000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: REQUESTER,
    requesterPubkey: REQUESTER,
    description: 'Test task',
    reward: '1000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'pending_approval',
    tags: [],
    worker: WORKER,
    rating: null,
    mode: 'bounty',
    stakeRequired: 0,
    stakeBps: 0,
    pitchDeadline: null,
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
    ...overrides,
  };
}

describe('acceptance router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('accept', () => {
    const acceptInput = { taskId: TASK_ID, worker: WORKER };

    it('throws when payer is missing', async () => {
      const ctx = createMockCtx(); // no payer
      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.accept(acceptInput)).rejects.toThrow('Payment required: missing payer');
    });

    it('throws when task not found', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.accept(acceptInput)).rejects.toThrow('Task not found');
    });

    it('throws when payer is not the requester', async () => {
      const ctx = createMockCtx('0xDifferentPayer000000000000000000000001');
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.accept(acceptInput)).rejects.toThrow(
        'Only the task requester can accept a submission'
      );
    });

    it('accepts submission, creates new agent, inserts platform fee', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()])) // task lookup
        .mockReturnValueOnce(makeChain([])); // agent lookup — not found (new agent)

      const caller = acceptanceRouter.createCaller(ctx);
      const result = await caller.accept(acceptInput);

      expect(result.success).toBe(true);
      expect(contractAcceptSubmission).toHaveBeenCalledOnce();
      // update task + insert new agent + insert platformFee = 1 update, 2 inserts
      expect(ctx.db.update).toHaveBeenCalledTimes(1);
      expect(ctx.db.insert).toHaveBeenCalledTimes(2);
    });

    it('accepts submission, updates existing agent stats', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(
          makeChain([
            {
              address: WORKER,
              completedTasks: 3,
              ratedTasks: 2,
              totalStars: 8,
              totalEarnings: '3000000',
              updatedAt: new Date(),
            },
          ])
        );

      const caller = acceptanceRouter.createCaller(ctx);
      const result = await caller.accept(acceptInput);

      expect(result.success).toBe(true);
      // update task + update agent + insert platformFee = 2 updates, 1 insert
      expect(ctx.db.update).toHaveBeenCalledTimes(2);
      expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('rate', () => {
    const rateInput = { taskId: TASK_ID, worker: WORKER, rating: 4 };

    it('throws when payer is missing', async () => {
      const ctx = createMockCtx();
      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.rate(rateInput)).rejects.toThrow('Payment required: missing payer');
    });

    it('throws when task is not accepted', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'open' })]));

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.rate(rateInput)).rejects.toThrow('Task not accepted');
    });

    it('throws when task not found', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.rate(rateInput)).rejects.toThrow('Task not accepted');
    });

    it('throws when payer is not the requester', async () => {
      const ctx = createMockCtx('0xDifferentPayer000000000000000000000001');
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'accepted' })]));

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.rate(rateInput)).rejects.toThrow(
        'Only the task requester can rate a task'
      );
    });

    it('rates task, inserts rating, updates agent stats on happy path', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ status: 'accepted' })])) // task lookup
        .mockReturnValueOnce(makeChain([])); // worker agent lookup (no agentId)

      const caller = acceptanceRouter.createCaller(ctx);
      const result = await caller.rate(rateInput);

      expect(result.success).toBe(true);
      expect(contractRateTask).toHaveBeenCalledOnce();
      // update tasks (rating) + update agents (stats) = 2 updates (feedback tx hash is in the insert)
      expect(ctx.db.update).toHaveBeenCalledTimes(2);
      // insert feedback (with ratingTxHash already populated)
      expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    });
  });
});
