import { createHash } from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/lib/storage', () => ({
  getStorageBackend: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue('file://test/submissions/task1/file'),
    getPresignedUrl: vi.fn().mockResolvedValue('https://presigned.example.com/file'),
  }),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    recoverMessageAddress: vi.fn(),
  };
});

vi.mock('../../../src/services/contract', () => ({
  contractSubmitWork: vi.fn().mockResolvedValue('0xsubmittx'),
}));

import { submissionsRouter } from '../../../src/routers/submissions.router';
import { recoverMessageAddress } from 'viem';
import { getStorageBackend } from '../../../src/lib/storage';
import { contractSubmitWork } from '../../../src/services/contract';

const WORKER = '0xWorker0000000000000000000000000000000001';
const REQUESTER = '0xRequester00000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const SUB_ID = '00000000-0000-0000-0000-000000000001';

const baseSubmitInput = {
  taskId: TASK_ID,
  workerAddress: WORKER,
  artifacts: [
    {
      fileName: 'submission.txt',
      mimeType: 'text/plain',
      role: 'attachment' as const,
      file: Buffer.from('test file content').toString('base64'),
    },
  ],
  signature: '0xsig',
};

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

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
    contractAddress: '0xContract000000000000000000000000000000000',
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
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));
      const submissionInsert = makeChain();
      const artifactInsert = makeChain();
      ctx.db.insert.mockReturnValueOnce(submissionInsert).mockReturnValueOnce(artifactInsert);

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(typeof result.submissionId).toBe('string');
      expect(ctx.db.insert).toHaveBeenCalledTimes(2);
      expect(submissionInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          fileUrl: 'file://test/submissions/task1/file',
          deliverableHash: expect.stringMatching(/^0x[a-fA-F0-9]{64}$/),
        })
      );
      expect(artifactInsert.values).toHaveBeenCalledWith([
        expect.objectContaining({
          taskId: TASK_ID,
          submissionId: result.submissionId,
          role: 'attachment',
          fileName: 'submission.txt',
          mimeType: 'text/plain',
          mediaKind: 'text',
          storageUri: 'file://test/submissions/task1/file',
          sizeBytes: Buffer.from('test file content').byteLength,
          sha256Hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          keccak256Hash: expect.stringMatching(/^0x[a-fA-F0-9]{64}$/),
          displayOrder: 0,
        }),
      ]);
      // status update: open task moves to pending_approval
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });

    it('submits multiple artifacts and anchors one manifest hash on chain', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const storage = getStorageBackend();
      vi.mocked(storage.upload)
        .mockResolvedValueOnce('file://test/submissions/task1/logo.png')
        .mockResolvedValueOnce('file://test/submissions/task1/source.svg');
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));
      const submissionInsert = makeChain();
      const artifactInsert = makeChain();
      ctx.db.insert.mockReturnValueOnce(submissionInsert).mockReturnValueOnce(artifactInsert);

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit({
        taskId: TASK_ID,
        workerAddress: WORKER,
        signature: '0xsig',
        artifacts: [
          {
            fileName: 'logo.png',
            mimeType: 'image/png',
            role: 'preview',
            file: Buffer.from('png bytes').toString('base64'),
          },
          {
            fileName: 'source.svg',
            mimeType: 'image/svg+xml',
            role: 'source',
            file: Buffer.from('<svg />').toString('base64'),
          },
        ],
      });

      expect(result.success).toBe(true);
      expect(storage.upload).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('logo.png'),
        expect.any(Buffer),
        { contentType: 'image/png' }
      );
      expect(storage.upload).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('source.svg'),
        expect.any(Buffer),
        { contentType: 'image/svg+xml' }
      );
      expect(contractSubmitWork).toHaveBeenCalledWith(
        TASK_ID,
        WORKER,
        expect.stringMatching(/^0x[a-fA-F0-9]{64}$/),
        expect.anything()
      );
      expect(artifactInsert.values).toHaveBeenCalledWith([
        expect.objectContaining({
          fileName: 'logo.png',
          mediaKind: 'image',
          displayOrder: 0,
        }),
        expect.objectContaining({
          fileName: 'source.svg',
          mediaKind: 'image',
          displayOrder: 1,
        }),
      ]);
    });

    it('persists submission rows and task status inside one transaction', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));
      const tx: any = {
        insert: vi.fn().mockReturnValue(makeChain()),
        update: vi.fn().mockReturnValue(makeChain()),
      };
      ctx.db.transaction.mockImplementationOnce(async (callback: (txArg: typeof tx) => unknown) =>
        callback(tx)
      );

      const caller = submissionsRouter.createCaller(ctx);
      await caller.submit(baseSubmitInput);

      expect(ctx.db.transaction).toHaveBeenCalledOnce();
      expect(tx.insert).toHaveBeenCalledTimes(2);
      expect(tx.update).toHaveBeenCalledOnce();
      expect(ctx.db.insert).not.toHaveBeenCalled();
      expect(ctx.db.update).not.toHaveBeenCalled();
    });

    it('submits to open benchmark task and updates status to pending_approval', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'benchmark', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });

    it('submits to pending_approval bounty task (additional worker)', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'bounty', status: 'pending_approval' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(typeof result.submissionId).toBe('string');
      expect(ctx.db.insert).toHaveBeenCalledTimes(2);
      // status already pending_approval, so no task status update
      expect(ctx.db.update).not.toHaveBeenCalled();
    });

    it('submits to claimed claim task by correct worker', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
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
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
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

    it('throws BAD_REQUEST when signature is invalid', async () => {
      vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Invalid signature');
    });

    it('throws UNAUTHORIZED when signature is from different address', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000001' as `0x${string}`
      );
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow(
        'Signature does not match worker address'
      );
    });
  });

  describe('preview', () => {
    const submissionRow = {
      id: SUB_ID,
      taskId: TASK_ID,
      workerAddress: WORKER,
      fileUrl: 'file://test/file',
      signature: '0xsig',
      submittedAt: new Date(),
    };
    const artifactRow = {
      id: 'artifact-1',
      taskId: TASK_ID,
      submissionId: SUB_ID,
      role: 'preview',
      fileName: 'logo.png',
      mimeType: 'image/png',
      mediaKind: 'image',
      storageUri: 'file://test/file',
      sizeBytes: 100,
      sha256Hash: 'a'.repeat(64),
      keccak256Hash: `0x${'b'.repeat(64)}`,
      displayOrder: 0,
      createdAt: new Date(),
    };
    const deviceRow = {
      id: 'device-1',
      apiTokenHash: sha256Hex('token-1'),
      walletAddress: WORKER,
      createdAt: new Date(),
      revokedAt: null,
    };

    it('returns the selected artifact URL for a worker device', async () => {
      const storage = getStorageBackend();
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([deviceRow]))
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(
          makeChain([{ ...artifactRow, id: 'artifact-2', storageUri: 'file://test/source.zip' }])
        );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.preview({
        taskId: TASK_ID,
        submissionId: SUB_ID,
        artifactId: 'artifact-2',
        deviceId: 'device-1',
        apiToken: 'token-1',
      });

      expect(result.presignedUrl).toBe('https://presigned.example.com/file');
      expect(storage.getPresignedUrl).toHaveBeenCalledWith('file://test/source.zip', 3600);
    });

    it('requires an artifact ID for device preview of multi-artifact submissions', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([deviceRow]))
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(
          makeChain([
            artifactRow,
            { ...artifactRow, id: 'artifact-2', storageUri: 'file://test/source.zip' },
          ])
        );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.preview({
          taskId: TASK_ID,
          submissionId: SUB_ID,
          deviceId: 'device-1',
          apiToken: 'token-1',
        })
      ).rejects.toThrow('--artifact is required for this submission');
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
    const artifactRow = {
      id: 'artifact-1',
      taskId: TASK_ID,
      submissionId: SUB_ID,
      role: 'preview',
      fileName: 'logo.png',
      mimeType: 'image/png',
      mediaKind: 'image',
      storageUri: 'file://test/file',
      sizeBytes: 100,
      sha256Hash: 'a'.repeat(64),
      keccak256Hash: `0x${'b'.repeat(64)}`,
      displayOrder: 0,
      createdAt: new Date(),
    };

    it('lists submissions with artifact metadata and no preview URLs', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(makeChain([]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result[0]?.artifacts).toEqual([
        expect.objectContaining({
          id: 'artifact-1',
          fileName: 'logo.png',
          mediaKind: 'image',
          storageUri: 'file://test/file',
        }),
      ]);
      expect(JSON.stringify(result)).not.toContain('presigned');
      expect(JSON.stringify(result)).not.toContain('previewUrl');
    });

    it('returns presigned URL when task is completed', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([{ ...makeTask(), status: 'completed' }]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.download({
        submissionId: SUB_ID,
        acceptanceTxHash: '0xaccepttx',
      });

      expect(result.presignedUrl).toBe('https://presigned.example.com/file');
    });

    it('returns the selected artifact URL when a completed submission has multiple artifacts', async () => {
      const storage = getStorageBackend();
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([{ ...makeTask(), status: 'completed' }]))
        .mockReturnValueOnce(makeChain([{ ...artifactRow, id: 'artifact-2', storageUri: 'file://test/source.zip' }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      const result = await caller.download({
        submissionId: SUB_ID,
        acceptanceTxHash: '0xaccepttx',
        artifactId: 'artifact-2',
      });

      expect(result.presignedUrl).toBe('https://presigned.example.com/file');
      expect(storage.getPresignedUrl).toHaveBeenCalledWith('file://test/source.zip', 3600);
    });

    it('requires an artifact ID to download completed multi-artifact submissions', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([{ ...makeTask(), status: 'completed' }]))
        .mockReturnValueOnce(
          makeChain([
            artifactRow,
            { ...artifactRow, id: 'artifact-2', storageUri: 'file://test/source.zip' },
          ])
        );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('--artifact is required for this submission');
    });

    it('throws when submission is not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('Submission not found');
    });

    it('throws when task is not completed', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([makeTask({ status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('Task not completed');
    });
  });

  describe('previewArtifact', () => {
    const artifactRow = {
      id: 'artifact-1',
      taskId: TASK_ID,
      submissionId: SUB_ID,
      role: 'preview',
      fileName: 'logo.png',
      mimeType: 'image/png',
      mediaKind: 'image',
      storageUri: 'file://test/file',
      sizeBytes: 100,
      sha256Hash: 'a'.repeat(64),
      keccak256Hash: `0x${'b'.repeat(64)}`,
      displayOrder: 0,
      createdAt: new Date(),
    };

    it('returns a preview URL for any caller', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([artifactRow]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      const result = await caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' });

      expect(result.previewUrl).toBe('https://presigned.example.com/file');
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects artifact preview requests with mismatched task IDs', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ ...artifactRow, taskId: '0xother' }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      await expect(
        caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' })
      ).rejects.toThrow('Task/artifact mismatch');
    });
  });
});
