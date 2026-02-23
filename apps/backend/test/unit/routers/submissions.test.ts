import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/lib/storage', () => ({
  getStorageBackend: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue('file://test/submissions/task1/file'),
    getPresignedUrl: vi.fn().mockResolvedValue('https://presigned.example.com/file'),
  }),
}));

import { submissionsRouter } from '../../../src/routers/submissions.router';

const WORKER = '0xWorker0000000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const SUB_ID = '00000000-0000-0000-0000-000000000001';

const baseSubmitInput = {
  taskId: TASK_ID,
  workerAddress: WORKER,
  file: Buffer.from('test file content').toString('base64'),
  signature: '0xsig',
};

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: '0xRequester',
    requesterPubkey: '0xRequester',
    description: 'Test task',
    reward: '1000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    worker: null,
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

describe('submissions router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submit', () => {
    it('throws when task is not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Task not found');
    });

    it('submits to open bounty task and updates status to pending_approval', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(typeof result.submissionId).toBe('string');
      expect(ctx.db.insert).toHaveBeenCalledOnce();
      // status update: open task moves to pending_approval
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });

    it('submits to open benchmark task and updates status to pending_approval', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'benchmark', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });

    it('submits to claimed claim task by correct worker', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: WORKER })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      // status is 'claimed' not 'open', so no task status update
      expect(ctx.db.update).not.toHaveBeenCalled();
    });

    it('throws when claim task is not claimed', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'claim', status: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Task not claimed');
    });

    it('throws when claim task claimer is a different worker', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: '0xOtherWorker' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Only claimer can submit');
    });

    it('submits to pitch task by selected worker', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'pitch', status: 'worker_selected', worker: WORKER })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
    });

    it('throws when pitch task worker is different', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({ mode: 'pitch', status: 'worker_selected', worker: '0xOtherWorker' }),
        ])
      );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow(
        'Only selected worker can submit'
      );
    });

    it('throws when pitch task worker is not yet selected', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'pitch', status: 'open', worker: null })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Worker not selected');
    });
  });

  describe('download', () => {
    const submissionRow = {
      id: SUB_ID,
      taskId: TASK_ID,
      workerAddress: WORKER,
      fileUrl: 'file://test/file',
      signature: '0xsig',
      submittedAt: new Date(),
    };

    it('returns presigned URL when task is accepted', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([{ ...makeTask(), status: 'accepted' }]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.download({
        submissionId: SUB_ID,
        acceptanceTxHash: '0xaccepttx',
      });

      expect(result.presignedUrl).toBe('https://presigned.example.com/file');
    });

    it('throws when submission is not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('Submission not found');
    });

    it('throws when task is not accepted', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([makeTask({ status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('Task not accepted');
    });
  });
});
