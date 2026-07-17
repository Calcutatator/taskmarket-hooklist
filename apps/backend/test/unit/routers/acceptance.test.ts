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
import { agents, taskAwards, tasks } from '../../../src/db/schema';

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

    it('throws BAD_REQUEST when no active submission found for bounty', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()])) // task fetch
        .mockReturnValueOnce(makeChain([])); // submission lookup — none found

      const caller = acceptanceRouter.createCaller(ctx);
      await expect(caller.accept(acceptInput)).rejects.toThrow('No active submission found');
    });

    it('calls contractAcceptSubmission with DB-derived deliverable for bounty', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()])) // task fetch
        .mockReturnValueOnce(makeChain([{ deliverableHash: DELIVERABLE }])) // submission lookup
        .mockReturnValueOnce(makeChain([])) // requester agent lookup
        .mockReturnValueOnce(makeChain([])); // worker agent lookup (self-award check)

      const caller = acceptanceRouter.createCaller(ctx);
      const result = await caller.accept(acceptInput);

      expect(result.success).toBe(true);
      expect(contractAcceptSubmission).toHaveBeenCalledOnce();
      const args = (contractAcceptSubmission as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(args[3]).toBe(DELIVERABLE); // deliverable from DB, not caller
    });
  });

  describe('acceptSubmissions', () => {
    const WORKER_B = '0xWorker0000000000000000000000000000000002';

    it('rejects when shares do not sum to 10000', async () => {
      const ctx = createMockCtx(REQUESTER);

      await expect(
        acceptanceRouter.createCaller(ctx).acceptSubmissions({
          taskId: TASK_ID,
          winners: [
            { worker: WORKER, share: 5000 },
            { worker: WORKER_B, share: 3000 },
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
          winners: [{ worker: WORKER, share: 10000 }],
        })
      ).rejects.toThrow('Only the task requester can accept submissions');
    });

    it('calls contractAcceptSubmissions and returns success', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()])) // task fetch
        .mockReturnValueOnce(makeChain([])); // requester agent lookup

      const result = await acceptanceRouter.createCaller(ctx).acceptSubmissions({
        taskId: TASK_ID,
        winners: [
          { worker: WORKER, share: 6000 },
          { worker: WORKER_B, share: 4000 },
        ],
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
      await expect(caller.rate(rateInput)).rejects.toThrow('Task not found');
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
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER, rating: null }])) // awards
        .mockReturnValueOnce(makeChain([])); // worker agent lookup (no agentId)

      const caller = acceptanceRouter.createCaller(ctx);
      const result = await caller.rate(rateInput);

      expect(result.success).toBe(true);
      expect(contractRateTask).toHaveBeenCalledOnce();
      expect(ctx.db.update).toHaveBeenCalledTimes(2);
      expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    });

    it('rejects a rating for a worker who is not an award recipient', async () => {
      const otherWorker = '0xWorker0000000000000000000000000000000002';
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ status: 'completed' })]))
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER, rating: null }]));

      await expect(
        acceptanceRouter.createCaller(ctx).rate({ ...rateInput, worker: otherWorker })
      ).rejects.toThrow('Worker is not an award recipient');

      expect(contractRateTask).not.toHaveBeenCalled();
    });

    it('rejects a duplicate-recipient rating when any matching award is already rated', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ status: 'completed' })]))
        .mockReturnValueOnce(
          makeChain([
            { workerAddress: WORKER, rating: 91 },
            { workerAddress: WORKER.toUpperCase(), rating: null },
          ])
        );

      await expect(acceptanceRouter.createCaller(ctx).rate(rateInput)).rejects.toThrow(
        'Award recipient is already rated'
      );

      expect(contractRateTask).not.toHaveBeenCalled();
    });

    it('projects a secondary-winner rating onto task_awards only, never the tasks table', async () => {
      const secondary = '0xWorker0000000000000000000000000000000002';
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ status: 'completed' })]))
        .mockReturnValueOnce(
          makeChain([
            { workerAddress: WORKER, rating: null },
            { workerAddress: secondary, rating: null },
          ])
        )
        .mockReturnValueOnce(makeChain([]));

      await acceptanceRouter.createCaller(ctx).rate({ ...rateInput, worker: secondary });

      expect(contractRateTask).toHaveBeenCalledWith(
        TASK_ID,
        REQUESTER,
        secondary,
        rateInput.rating,
        0n,
        0n,
        expect.any(String),
        expect.any(String),
        undefined
      );
      const updatedTables = ctx.db.update.mock.calls.map(([table]: [unknown]) => table);
      expect(updatedTables).toContain(taskAwards);
      expect(updatedTables).toContain(agents);
      expect(updatedTables).not.toContain(tasks);
    });
  });
});
