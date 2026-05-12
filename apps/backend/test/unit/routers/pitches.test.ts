import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractSelectWorker: vi.fn().mockResolvedValue('0xselecttx'),
  contractSubmitPitch: vi.fn().mockResolvedValue('0xpitchtx'),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    recoverMessageAddress: vi.fn(),
  };
});

import { pitchesRouter } from '../../../src/routers/pitches.router';
import { contractSelectWorker } from '../../../src/services/contract';
import { recoverMessageAddress } from 'viem';

const REQUESTER = '0xRe9ue57e10000000000000000000000000000001';
const WORKER = '0x0000000000000000000000000000000000000001';
const TASK_ID = '0x7461736b00000000000000000000000000000000000000000000000000000001';
const PITCH_ID = '00000000-0000-0000-0000-000000000001';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: REQUESTER,
    requesterPubkey: REQUESTER,
    description: 'Pitch task',
    reward: '1000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    worker: null,
    rating: null,
    mode: 'pitch',
    stakeRequired: 0,
    stakeBps: 0,
    pitchDeadline: new Date(Date.now() + 3600000),
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
    ...overrides,
  };
}

describe('pitches router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submit', () => {
    const submitInput = {
      taskId: TASK_ID,
      workerAddress: WORKER,
      pitchText: 'My pitch',
      signature: '0xsig',
    };

    it('throws when task not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not pitch', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'benchmark' })]));

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Not a Pitch task');
    });

    it('throws when task is not open', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'worker_selected' })]));

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not open for pitches');
    });

    it('throws when pitch deadline has passed', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ pitchDeadline: new Date(Date.now() - 1000) })])
      );

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Pitch deadline has passed');
    });

    it('throws when worker already submitted a pitch', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        // existing pitch check returns a duplicate
        .mockReturnValueOnce(makeChain([{ id: 'existing-pitch', workerAddress: WORKER }]));

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow(
        'Worker has already submitted a pitch'
      );
    });

    it('inserts pitch and returns proposalId on happy path', async () => {
      const ctx = createMockCtx(WORKER); // X402 payer = worker
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()])).mockReturnValueOnce(makeChain([])); // no duplicate

      const caller = pitchesRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(typeof result.pitchId).toBe('string');
      expect(ctx.db.insert).toHaveBeenCalledOnce();
    });

    it('throws BAD_REQUEST when X402 payer is missing', async () => {
      const ctx = createMockCtx(); // no payer
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()])).mockReturnValueOnce(makeChain([])); // no duplicate

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Payment required');
    });

    it('throws FORBIDDEN when X402 payer does not match workerAddress', async () => {
      const OTHER = '0x9999999999999999999999999999999999999999';
      const ctx = createMockCtx(OTHER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()])).mockReturnValueOnce(makeChain([])); // no duplicate

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Payer must match workerAddress');
    });
  });

  describe('listByTask', () => {
    it('returns pitches with worker stats', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            {
              id: PITCH_ID,
              taskId: TASK_ID,
              workerAddress: WORKER,
              proposalText: 'My pitch',
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

      const caller = pitchesRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(1);
      expect(result[0].workerStats).toBeDefined();
      expect(result[0].workerStats!.completedTasks).toBe(5);
    });

    it('returns pitches with no workerStats when agent not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            {
              id: PITCH_ID,
              taskId: TASK_ID,
              workerAddress: WORKER,
              proposalText: 'My pitch',
              estimatedDuration: null,
              status: 'pending',
              submittedAt: new Date(),
            },
          ])
        )
        .mockReturnValueOnce(makeChain([])); // no agent

      const caller = pitchesRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result[0].workerStats).toBeUndefined();
    });
  });

  describe('select', () => {
    const selectInput = {
      taskId: TASK_ID,
      workerAddress: WORKER,
      pitchId: PITCH_ID,
      signature: '0xsig',
    };

    it('throws when payer does not match requester', async () => {
      const ctx = createMockCtx('0xDifferentPayer000000000000000000000001');
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.select(selectInput)).rejects.toThrow(
        'Only the task requester can select a worker'
      );
    });

    it('throws when task is not found', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.select(selectInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not pitch', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.select(selectInput)).rejects.toThrow('Not a Pitch task');
    });

    it('throws when task is not open', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'worker_selected' })]));

      const caller = pitchesRouter.createCaller(ctx);
      await expect(caller.select(selectInput)).rejects.toThrow('Task not open');
    });

    it('calls contractSelectWorker and updates 3 DB rows on happy path', async () => {
      const ctx = createMockCtx(REQUESTER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = pitchesRouter.createCaller(ctx);
      const result = await caller.select(selectInput);

      expect(result.success).toBe(true);
      expect(contractSelectWorker).toHaveBeenCalledOnce();
      // selected pitch, rejected others, task status update = 3 update calls
      expect(ctx.db.update).toHaveBeenCalledTimes(3);
    });
  });
});
