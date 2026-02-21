import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractClaimTask: vi.fn().mockResolvedValue('0xstaketx'),
}));

import { claimsRouter } from '../../../src/routers/claims.router';
import { contractClaimTask } from '../../../src/services/contract';

const WORKER = '0xWorker0000000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: '0xRequester',
    requesterPubkey: '0xRequester',
    description: 'Instant task',
    reward: '1000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    worker: null,
    rating: null,
    mode: 'instant',
    stakeRequired: 0,
    stakeBps: 0,
    proposalDeadline: null,
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
    ...overrides,
  };
}

describe('claims router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('claim', () => {
    const claimInput = { taskId: TASK_ID, workerAddress: WORKER, signature: '0xsig' };

    it('throws when task not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(claimInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not instant', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'contest' })]));

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(claimInput)).rejects.toThrow('Not an Instant task');
    });

    it('throws when task is already claimed (status != open)', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'claimed' })]));

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(claimInput)).rejects.toThrow('Task not available for claiming');
    });

    it('claims task on happy path', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.claim(claimInput);

      expect(result.success).toBe(true);
      expect(typeof result.claimId).toBe('string');
      expect(contractClaimTask).toHaveBeenCalledOnce();
      expect(contractClaimTask).toHaveBeenCalledWith(TASK_ID, WORKER, 0n);
      expect(ctx.db.insert).toHaveBeenCalledOnce();
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });
  });

  describe('getByTask', () => {
    it('returns null when no claim exists', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.getByTask({ taskId: TASK_ID });

      expect(result).toBeNull();
    });

    it('returns claim when found', async () => {
      const claimRow = {
        id: 'claim-id-1',
        taskId: TASK_ID,
        workerAddress: WORKER,
        stakeAmount: '0',
        stakeTxHash: '0xstaketx',
        claimedAt: new Date(),
        status: 'active',
      };

      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([claimRow]));

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.getByTask({ taskId: TASK_ID });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('claim-id-1');
      expect(result!.workerAddress).toBe(WORKER);
      expect(result!.status).toBe('active');
    });
  });
});
