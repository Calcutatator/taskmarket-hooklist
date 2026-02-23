import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

import { proofsRouter } from '../../../src/routers/proofs.router';

const WORKER = '0xWorker0000000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const PROOF_ID = '00000000-0000-0000-0000-000000000001';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: '0xRequester',
    requesterPubkey: '0xRequester',
    description: 'Benchmark task',
    reward: '1000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    worker: null,
    rating: null,
    mode: 'benchmark',
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

describe('proofs router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submit', () => {
    const submitInput = {
      taskId: TASK_ID,
      workerAddress: WORKER,
      proofData: 'proof-data-hash',
      proofType: 'url' as const,
      signature: '0xsig',
    };

    it('throws when task not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not benchmark', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Not a Benchmark task');
    });

    it('throws when task is not open', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'pending_approval' })]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not open for proof submission');
    });

    it('inserts proof and returns proofId on happy path', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(typeof result.proofId).toBe('string');
      expect(ctx.db.insert).toHaveBeenCalledOnce();
    });
  });

  describe('verify', () => {
    // NOTE: the verify endpoint has no authentication guard — any caller can
    // verify any proof by supplying a proofId and taskId. This is a security
    // gap; tests document existing behaviour without validating authorisation.
    it('updates proof to verified and task to accepted', async () => {
      const ctx = createMockCtx();

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.verify({
        proofId: PROOF_ID,
        taskId: TASK_ID,
        txHash: '0xverifytx',
      });

      expect(result.success).toBe(true);
      // update proofs status + update tasks status = 2 update calls
      expect(ctx.db.update).toHaveBeenCalledTimes(2);
    });

    it('allows any caller to verify (no auth check)', async () => {
      // Verify works with no payer set — documents the absence of auth guard
      const ctx = createMockCtx(); // no payer

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.verify({
        proofId: PROOF_ID,
        taskId: TASK_ID,
        txHash: '0xverifytx',
      });

      expect(result.success).toBe(true);
    });
  });
});
