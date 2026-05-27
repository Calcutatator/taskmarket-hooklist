import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractAcceptSubmission: vi.fn().mockResolvedValue('0xaccepttx'),
  contractAcceptSubmissions: vi.fn().mockResolvedValue('0xacceptrankedtx'),
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
import {
  contractAcceptSubmission,
  contractAcceptSubmissions,
  contractRateTask,
} from '../../../src/services/contract';

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
    const DELIVERABLE = `0x${'ab'.repeat(32)}` as const;
    const acceptInput = { taskId: TASK_ID, worker: WORKER, deliverable: DELIVERABLE };

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

    it('calls contractAcceptSubmission and returns success — no DB writes', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = acceptanceRouter.createCaller(ctx);
      const result = await caller.accept(acceptInput);

      expect(result.success).toBe(true);
      expect(contractAcceptSubmission).toHaveBeenCalledOnce();
      // indexer is the sole writer of task state — acceptance router makes no DB writes
      expect(ctx.db.update).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
    });
  });

  describe('acceptSubmissions', () => {
    const DELIVERABLE_A = `0x${'aa'.repeat(32)}` as const;
    const DELIVERABLE_B = `0x${'bb'.repeat(32)}` as const;
    const WORKER_B = '0xWorker0000000000000000000000000000000002';

    it('rejects when shares do not sum to 10000', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await expect(
        acceptanceRouter.createCaller(ctx).acceptSubmissions({
          taskId: TASK_ID,
          winners: [
            { worker: WORKER, share: 5000, deliverable: DELIVERABLE_A },
            { worker: WORKER_B, share: 3000, deliverable: DELIVERABLE_B },
          ],
        })
      ).rejects.toThrow('Winner shares must sum to 10000');
    });

    it('rejects when payer is not the requester', async () => {
      const ctx = createMockCtx('0xOtherPayer00000000000000000000000000001');
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await expect(
        acceptanceRouter.createCaller(ctx).acceptSubmissions({
          taskId: TASK_ID,
          winners: [{ worker: WORKER, share: 10000, deliverable: DELIVERABLE_A }],
        })
      ).rejects.toThrow('Only the task requester can accept submissions');
    });

    it('rejects when no deliverable can be resolved for a winner', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([])); // no submission row found

      await expect(
        acceptanceRouter.createCaller(ctx).acceptSubmissions({
          taskId: TASK_ID,
          winners: [{ worker: WORKER, share: 10000 }],
        })
      ).rejects.toThrow('No deliverable found for worker');
    });

    it('calls contractAcceptSubmissions with explicit deliverable hashes', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await acceptanceRouter.createCaller(ctx).acceptSubmissions({
        taskId: TASK_ID,
        winners: [
          { worker: WORKER, share: 6000, deliverable: DELIVERABLE_A },
          { worker: WORKER_B, share: 4000, deliverable: DELIVERABLE_B },
        ],
      });

      expect(contractAcceptSubmissions).toHaveBeenCalledOnce();
    });

    it('resolves deliverable from latest submission row when not explicit', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([{ deliverableHash: DELIVERABLE_A }]));

      const result = await acceptanceRouter.createCaller(ctx).acceptSubmissions({
        taskId: TASK_ID,
        winners: [{ worker: WORKER, share: 10000 }],
      });

      expect(result.success).toBe(true);
      expect(contractAcceptSubmissions).toHaveBeenCalledOnce();
    });
  });

  describe('rate', () => {
    const rateInput = { taskId: TASK_ID, worker: WORKER, rating: 4 };

    it('throws when payer is missing', async () => {
      const ctx = createMockCtx();
      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.rate(rateInput)).rejects.toThrow('Payment required: missing payer');
    });

    it('throws when task is not completed', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'open' })]));

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.rate(rateInput)).rejects.toThrow('Task not completed');
    });

    it('throws when task not found', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.rate(rateInput)).rejects.toThrow('Task not completed');
    });

    it('throws when payer is not the requester', async () => {
      const ctx = createMockCtx('0xDifferentPayer000000000000000000000001');
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'completed' })]));

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.rate(rateInput)).rejects.toThrow(
        'Only the task requester can rate a task'
      );
    });

    it('rates task, inserts feedback, updates agent stats on happy path', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ status: 'completed' })])) // task lookup
        .mockReturnValueOnce(makeChain([])); // worker agent lookup (no agentId)

      const caller = acceptanceRouter.createCaller(ctx);
      const result = await caller.rate(rateInput);

      expect(result.success).toBe(true);
      expect(contractRateTask).toHaveBeenCalledOnce();
      expect(ctx.db.update).toHaveBeenCalledTimes(2);
      expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    });
  });
});
