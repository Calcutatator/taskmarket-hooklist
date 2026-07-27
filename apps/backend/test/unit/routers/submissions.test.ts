import { createHash } from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/lib/storage', () => ({
  getStorageBackend: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue('file://test/submissions/task1/file'),
    getPresignedUrl: vi.fn().mockResolvedValue('https://presigned.example.com/file'),
    headObject: vi.fn().mockResolvedValue({ contentLength: 123 }),
    storageUriForKey: vi.fn((key: string) => `file://test/${key}`),
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
    mode: 'bounty',
    submissionVisibility: 'public',
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

    it('submits to open bounty task and keeps it open', async () => {
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
      // Bounty is an open contest: the task stays `open` and keeps accepting
      // submissions, so submitting must NOT flip the task status.
      expect(ctx.db.update).not.toHaveBeenCalled();
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

    it('persists submission rows inside one transaction without flipping task status', async () => {
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
      // Bounty stays `open` as an open contest, so submitting flips no status.
      expect(tx.update).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
      expect(ctx.db.update).not.toHaveBeenCalled();
    });

    it('submits to open benchmark task and keeps it open', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'benchmark', status: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      // Benchmark is an open contest like bounty: submitting must NOT flip status.
      expect(ctx.db.update).not.toHaveBeenCalled();
    });

    it('accepts an additional submission to an open bounty without changing status', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(typeof result.submissionId).toBe('string');
      expect(ctx.db.insert).toHaveBeenCalledTimes(2);
      // Open contest stays open across submissions, so no task status update.
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
      // claim task flips to pending_approval after submission so requester can accept
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });

    it('throws when claim task is not claimed', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'claim', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Task not claimed');
    });

    it('throws when claim task worker is a different worker (valid signature, still rejected)', async () => {
      // The claimedBy comparison now runs AFTER signature verification (pre-auth
      // oracle fix) -- a valid signature over WORKER must still be rejected when
      // WORKER isn't the task's assigned worker, same as before the reorder.
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: '0xOtherWorker' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Only worker can submit');
    });

    it('submits to pitch task by selected worker', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'pitch', status: 'worker_selected', claimedBy: WORKER })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      // pitch task flips to pending_approval after submission so requester can accept
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });

    it('throws when pitch task worker is different (valid signature, still rejected)', async () => {
      // Same reorder as the claim-mode case above: signature verification runs
      // before the claimedBy comparison now, but a valid signature over a
      // non-selected worker is still rejected.
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({ mode: 'pitch', status: 'worker_selected', claimedBy: '0xOtherWorker' }),
        ])
      );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow(
        'Only selected worker can submit'
      );
    });

    it('throws when pitch task worker is not yet selected', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'pitch', status: 'open' })]));

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

    describe('claimedBy pre-auth oracle ordering', () => {
      // Regression coverage for the claimedBy pre-auth oracle finding: comparing
      // task.claimedBy against input.workerAddress before the caller has proven
      // they control that address would let an attacker submit an arbitrary
      // candidate address with no valid signature and use the
      // signature-error-vs-claimedBy-mismatch-error distinction to learn whether
      // that address is the task's assigned worker. The fix moves the claimedBy
      // comparison to run after verifySignedAddressOrThrow succeeds, for every mode
      // branch that has it (claim/pitch/auction).
      const OTHER_WORKER = '0xOtherWorkerAddr00000000000000000000001';

      it('rejects an unsigned candidate address with a signature error, not a claimedBy-mismatch error (claim mode)', async () => {
        vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Invalid signature');
      });

      it('rejects an unsigned candidate address with a signature error, not a claimedBy-mismatch error (pitch mode)', async () => {
        vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([
            makeTask({ mode: 'pitch', status: 'worker_selected', claimedBy: OTHER_WORKER }),
          ])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Invalid signature');
      });

      it('rejects an unsigned candidate address with a signature error, not a claimedBy-mismatch error (auction mode)', async () => {
        vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'auction', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Invalid signature');
      });

      it('submits successfully for the winning bidder on an auction task once selected', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'auction', status: 'claimed', claimedBy: WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submit(baseSubmitInput);

        expect(result.success).toBe(true);
        // auction task flips to pending_approval after submission so requester can accept
        expect(ctx.db.update).toHaveBeenCalledOnce();
      });

      it('rejects a valid-signature caller who is not the winning bidder on an auction task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'auction', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submit(baseSubmitInput)).rejects.toThrow(
          'Only the winning bidder can submit'
        );
      });
    });

    describe('private task submission standing', () => {
      const ALLOWED_VIEWER = '0xAllowedViewer0000000000000000000000001';
      const OUTSIDER = '0xOutsider000000000000000000000000000001';

      it('rejects an outsider submitting to a private bounty task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(OUTSIDER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'bounty', status: 'open', taskVisibility: 'private' })])
          )
          .mockReturnValueOnce(makeChain([])) // task_awards: no match
          .mockReturnValueOnce(makeChain([])); // task_allowed_viewers: no match

        const caller = submissionsRouter.createCaller(ctx);
        await expect(
          caller.submit({ ...baseSubmitInput, workerAddress: OUTSIDER })
        ).rejects.toThrow('Not authorized to submit to this private task');
      });

      it('rejects a taskAccessGrant holder (view-only) submitting to a private benchmark task', async () => {
        // A valid password-derived taskAccessGrant proves view access, not
        // submission standing -- must not be accepted as a substitute here.
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(OUTSIDER as `0x${string}`);
        const ctx = createMockCtx(undefined, undefined, { taskId: TASK_ID });
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'benchmark', status: 'open', taskVisibility: 'private' })])
          )
          .mockReturnValueOnce(makeChain([]))
          .mockReturnValueOnce(makeChain([]));

        const caller = submissionsRouter.createCaller(ctx);
        await expect(
          caller.submit({ ...baseSubmitInput, workerAddress: OUTSIDER })
        ).rejects.toThrow('Not authorized to submit to this private task');
      });

      it('allows the pre-assigned claimedBy worker to submit to a private bounty task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([
            makeTask({
              mode: 'bounty',
              status: 'open',
              taskVisibility: 'private',
              claimedBy: WORKER,
            }),
          ])
        );

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submit(baseSubmitInput);

        expect(result.success).toBe(true);
      });

      it('allows an allowlisted viewer to submit to a private benchmark task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(ALLOWED_VIEWER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'benchmark', status: 'open', taskVisibility: 'private' })])
          )
          .mockReturnValueOnce(makeChain([])) // task_awards: no match
          .mockReturnValueOnce(makeChain([{ viewerAddress: ALLOWED_VIEWER }]));

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submit({
          ...baseSubmitInput,
          workerAddress: ALLOWED_VIEWER,
        });

        expect(result.success).toBe(true);
      });
    });
  });

  describe('submitFromKeys', () => {
    const ARTIFACT_KEY = `submissions/${TASK_ID}/pending/submission.txt`;
    const baseFromKeysInput = {
      taskId: TASK_ID,
      workerAddress: WORKER,
      signature: '0xsig',
      artifacts: [
        {
          artifactKey: ARTIFACT_KEY,
          fileName: 'submission.txt',
          mimeType: 'text/plain',
          role: 'attachment' as const,
          sizeBytes: 123,
          sha256Hash: 'a'.repeat(64),
          keccak256Hash: `0x${'b'.repeat(64)}`,
        },
      ],
    };

    describe('private task submission standing', () => {
      const ALLOWED_VIEWER = '0xAllowedViewer0000000000000000000000002';
      const OUTSIDER = '0xOutsider000000000000000000000000000002';

      it('rejects an outsider submitting to a private bounty task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(OUTSIDER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'bounty', status: 'open', taskVisibility: 'private' })])
          )
          .mockReturnValueOnce(makeChain([])) // task_awards: no match
          .mockReturnValueOnce(makeChain([])); // task_allowed_viewers: no match

        const caller = submissionsRouter.createCaller(ctx);
        await expect(
          caller.submitFromKeys({ ...baseFromKeysInput, workerAddress: OUTSIDER })
        ).rejects.toThrow('Not authorized to submit to this private task');
      });

      it('rejects a taskAccessGrant holder (view-only) submitting to a private benchmark task', async () => {
        // A valid password-derived taskAccessGrant proves view access, not
        // submission standing -- must not be accepted as a substitute here.
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(OUTSIDER as `0x${string}`);
        const ctx = createMockCtx(undefined, undefined, { taskId: TASK_ID });
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'benchmark', status: 'open', taskVisibility: 'private' })])
          )
          .mockReturnValueOnce(makeChain([]))
          .mockReturnValueOnce(makeChain([]));

        const caller = submissionsRouter.createCaller(ctx);
        await expect(
          caller.submitFromKeys({ ...baseFromKeysInput, workerAddress: OUTSIDER })
        ).rejects.toThrow('Not authorized to submit to this private task');
      });

      it('allows the pre-assigned claimedBy worker to submit to a private bounty task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([
            makeTask({
              mode: 'bounty',
              status: 'open',
              taskVisibility: 'private',
              claimedBy: WORKER,
            }),
          ])
        );

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submitFromKeys(baseFromKeysInput);

        expect(result.success).toBe(true);
      });

      it('allows an allowlisted viewer to submit to a private benchmark task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(ALLOWED_VIEWER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'benchmark', status: 'open', taskVisibility: 'private' })])
          )
          .mockReturnValueOnce(makeChain([])) // task_awards: no match
          .mockReturnValueOnce(makeChain([{ viewerAddress: ALLOWED_VIEWER }]));

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submitFromKeys({
          ...baseFromKeysInput,
          workerAddress: ALLOWED_VIEWER,
        });

        expect(result.success).toBe(true);
      });
    });

    describe('claimedBy pre-auth oracle ordering', () => {
      // Same regression coverage as submit's block above, adapted for
      // submitFromKeys -- the claimedBy comparison must run after signature
      // verification here too, for every mode branch that has it.
      const OTHER_WORKER = '0xOtherWorkerAddr00000000000000000000002';

      it('rejects an unsigned candidate address with a signature error, not a claimedBy-mismatch error (claim mode)', async () => {
        vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submitFromKeys(baseFromKeysInput)).rejects.toThrow('Invalid signature');
      });

      it('rejects an unsigned candidate address with a signature error, not a claimedBy-mismatch error (pitch mode)', async () => {
        vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([
            makeTask({ mode: 'pitch', status: 'worker_selected', claimedBy: OTHER_WORKER }),
          ])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submitFromKeys(baseFromKeysInput)).rejects.toThrow('Invalid signature');
      });

      it('rejects an unsigned candidate address with a signature error, not a claimedBy-mismatch error (auction mode)', async () => {
        vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'auction', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submitFromKeys(baseFromKeysInput)).rejects.toThrow('Invalid signature');
      });

      it('submits successfully for the pre-assigned worker on a claim task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submitFromKeys(baseFromKeysInput);

        expect(result.success).toBe(true);
      });

      it('rejects a valid-signature caller who is not the assigned worker on a claim task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submitFromKeys(baseFromKeysInput)).rejects.toThrow(
          'Only worker can submit'
        );
      });
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
        .mockReturnValueOnce(makeChain([makeTask()]))
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

    it('includes media preview URLs on request while batching worker agent lookup', async () => {
      const storage = getStorageBackend();
      const ctx = createMockCtx();
      const secondSubmissionRow = {
        ...submissionRow,
        id: '00000000-0000-0000-0000-000000000002',
        workerAddress: '0xWorker0000000000000000000000000000000002',
      };
      const textArtifactRow = {
        ...artifactRow,
        id: 'artifact-text',
        fileName: 'notes.txt',
        mediaKind: 'text',
        mimeType: 'text/plain',
        displayOrder: 2,
      };
      const videoArtifactRow = {
        ...artifactRow,
        id: 'artifact-video',
        fileName: 'demo.mp4',
        mediaKind: 'video',
        mimeType: 'video/mp4',
        storageUri: 'file://test/demo.mp4',
        displayOrder: 1,
      };
      const imageArtifactRow = {
        ...artifactRow,
        id: 'artifact-image',
        submissionId: secondSubmissionRow.id,
        fileName: 'result.png',
        mediaKind: 'image',
        mimeType: 'image/png',
        storageUri: 'file://test/result.png',
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([submissionRow, secondSubmissionRow]))
        .mockReturnValueOnce(makeChain([textArtifactRow, videoArtifactRow, imageArtifactRow]))
        .mockReturnValueOnce(
          makeChain([
            {
              address: WORKER,
              agentId: 'agent-one',
              averageRating: 0,
              completedTasks: 7,
              ratedTasks: 2,
              totalStars: 9,
            },
            {
              address: secondSubmissionRow.workerAddress,
              agentId: 'agent-two',
              averageRating: 0,
              completedTasks: 3,
              ratedTasks: 1,
              totalStars: 5,
            },
          ])
        );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.listByTask({
        includePreviewUrls: 'media',
        taskId: TASK_ID,
      });

      expect(ctx.db.select).toHaveBeenCalledTimes(4);
      expect(storage.getPresignedUrl).toHaveBeenCalledTimes(2);
      expect(storage.getPresignedUrl).toHaveBeenNthCalledWith(1, 'file://test/demo.mp4', 3600);
      expect(storage.getPresignedUrl).toHaveBeenNthCalledWith(2, 'file://test/result.png', 3600);
      expect(result[0]?.workerAgentId).toBe('agent-one');
      expect(result[1]?.workerAgentId).toBe('agent-two');
      expect(result[0]?.artifacts.map((artifact) => artifact.id)).toEqual([
        'artifact-video',
        'artifact-text',
      ]);
      expect(result[0]?.artifacts[0]).toEqual(
        expect.objectContaining({
          id: 'artifact-video',
          previewExpiresAt: expect.any(String),
          previewUrl: 'https://presigned.example.com/file',
        })
      );
      expect(result[0]?.artifacts[1]).not.toHaveProperty('previewUrl');
      expect(result[1]?.artifacts[0]).toEqual(
        expect.objectContaining({
          id: 'artifact-image',
          previewUrl: 'https://presigned.example.com/file',
        })
      );
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
        .mockReturnValueOnce(
          makeChain([{ ...artifactRow, id: 'artifact-2', storageUri: 'file://test/source.zip' }])
        );

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

    it('rejects downloading a never-mode submission for an unauthenticated caller', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(
          makeChain([{ ...makeTask(), status: 'completed', submissionVisibility: 'never' }])
        );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('Not authorized to download this submission');
    });

    it('allows the submitting worker to download their own never-mode submission', async () => {
      const ctx = createMockCtx(undefined, { address: WORKER });
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(
          makeChain([{ ...makeTask(), status: 'completed', submissionVisibility: 'never' }])
        );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.download({
        submissionId: SUB_ID,
        acceptanceTxHash: '0xaccepttx',
      });

      expect(result.presignedUrl).toBe('https://presigned.example.com/file');
    });

    it('allows an anonymous caller to download a reveal_all submission once completed', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(
          makeChain([{ ...makeTask(), status: 'completed', submissionVisibility: 'reveal_all' }])
        );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.download({
        submissionId: SUB_ID,
        acceptanceTxHash: '0xaccepttx',
      });

      expect(result.presignedUrl).toBe('https://presigned.example.com/file');
    });

    it('allows an anonymous caller to download a winner_only submission that is the task_awards winner', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(
          makeChain([{ ...makeTask(), status: 'completed', submissionVisibility: 'winner_only' }])
        )
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.download({
        submissionId: SUB_ID,
        acceptanceTxHash: '0xaccepttx',
      });

      expect(result.presignedUrl).toBe('https://presigned.example.com/file');
    });

    it('rejects an anonymous caller downloading a winner_only submission that is NOT a task_awards winner', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(
          makeChain([{ ...makeTask(), status: 'completed', submissionVisibility: 'winner_only' }])
        )
        .mockReturnValueOnce(
          makeChain([{ workerAddress: '0xSomeoneElse000000000000000000000001' }])
        );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('Not authorized to download this submission');
    });
  });

  describe('listByTask submissionVisibility gating', () => {
    const submissionRow = {
      id: SUB_ID,
      taskId: TASK_ID,
      workerAddress: WORKER,
      fileUrl: 'file://test/file',
      signature: '0xsig',
      submittedAt: new Date(),
    };
    const otherSubmissionRow = {
      ...submissionRow,
      id: '00000000-0000-0000-0000-000000000002',
      workerAddress: '0xWorker0000000000000000000000000000000002',
    };

    it('never mode hides every submission from an unauthenticated caller while active', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'never', status: 'open' })])
        )
        .mockReturnValueOnce(makeChain([submissionRow]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toEqual([]);
    });

    it('never mode still lets the requester see every submission while active', async () => {
      const ctx = createMockCtx(undefined, { address: REQUESTER });
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'never', status: 'open' })])
        )
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(SUB_ID);
    });

    it('winner_only reveals only the task_awards-linked winner once the task ends', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'winner_only', status: 'completed' })])
        )
        .mockReturnValueOnce(makeChain([submissionRow, otherSubmissionRow]))
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(1);
      expect(result[0].workerAddress).toBe(WORKER);
    });

    it('winner_only reveals every ranked-payout winner, not just one, while still hiding non-winners', async () => {
      // Ranked payout: task_awards can have more than one row per task (see
      // ADR-0006 / the worker-identity correction in the RFC) -- confirm
      // winningAddressesForTask's Set correctly includes every winner, not
      // just the first one, and that a genuine non-winner still stays hidden.
      const thirdSubmissionRow = {
        ...submissionRow,
        id: '00000000-0000-0000-0000-000000000003',
        workerAddress: '0xWorker0000000000000000000000000000000003',
      };
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'winner_only', status: 'completed' })])
        )
        .mockReturnValueOnce(makeChain([submissionRow, otherSubmissionRow, thirdSubmissionRow]))
        .mockReturnValueOnce(
          makeChain([
            { workerAddress: WORKER },
            { workerAddress: otherSubmissionRow.workerAddress },
          ])
        )
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result.map((r) => r.workerAddress).sort()).toEqual(
        [WORKER, otherSubmissionRow.workerAddress].sort()
      );
      expect(result.some((r) => r.workerAddress === thirdSubmissionRow.workerAddress)).toBe(false);
    });

    it('returns an empty array for an unknown taskId without checking visibility', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: 'nonexistent' });

      expect(result).toEqual([]);
      expect(ctx.db.select).toHaveBeenCalledTimes(1);
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
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(makeChain([makeTask()]));

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

    it('rejects previewing a never-mode artifact for an unauthenticated caller', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'never', status: 'open' })])
        )
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      await expect(
        caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' })
      ).rejects.toThrow('Not authorized to preview this artifact');
    });

    it('allows the submitting worker to preview their own never-mode artifact', async () => {
      const ctx = createMockCtx(undefined, { address: WORKER });
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'never', status: 'open' })])
        )
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      const result = await caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' });

      expect(result.previewUrl).toBe('https://presigned.example.com/file');
    });

    it('allows an anonymous caller to preview a reveal_all artifact once the task has ended', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'reveal_all', status: 'completed' })])
        )
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      const result = await caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' });

      expect(result.previewUrl).toBe('https://presigned.example.com/file');
    });

    it('allows an anonymous caller to preview a winner_only artifact that is the task_awards winner', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'winner_only', status: 'completed' })])
        )
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]))
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      const result = await caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' });

      expect(result.previewUrl).toBe('https://presigned.example.com/file');
    });

    it('rejects an anonymous caller previewing a winner_only artifact that is NOT the winner', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(
          makeChain([makeTask({ submissionVisibility: 'winner_only', status: 'completed' })])
        )
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]))
        .mockReturnValueOnce(
          makeChain([{ workerAddress: '0xSomeoneElse000000000000000000000001' }])
        );

      const caller = submissionsRouter.createCaller(ctx) as any;
      await expect(
        caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' })
      ).rejects.toThrow('Not authorized to preview this artifact');
    });

    it('treats a REJECT-verdict cancelled task as ended for reveal_all preview', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(
          makeChain([
            makeTask({
              submissionVisibility: 'reveal_all',
              status: 'cancelled',
              verdictType: 'REJECT',
            }),
          ])
        )
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      const result = await caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' });

      expect(result.previewUrl).toBe('https://presigned.example.com/file');
    });

    it('treats a plain (non-verdict) cancelled task as still active for reveal_all preview', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(
          makeChain([
            makeTask({
              submissionVisibility: 'reveal_all',
              status: 'cancelled',
              verdictType: null,
            }),
          ])
        )
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      await expect(
        caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' })
      ).rejects.toThrow('Not authorized to preview this artifact');
    });
  });

  describe('mySubmissions submissionVisibility gating', () => {
    const OTHER_TASK_ID = '0xtask0000000000000000000000000000000002';
    const OTHER_WORKER = '0xWorker0000000000000000000000000000000002';

    function myRow(overrides: Record<string, any> = {}) {
      return {
        taskId: TASK_ID,
        workerAddress: WORKER,
        submittedAt: new Date('2026-06-10T10:00:00.000Z'),
        deliverableHash: null,
        submitTxHash: null,
        rejectedAt: null,
        taskDescription: 'Test task',
        taskStatus: 'open',
        taskVerdictType: null,
        taskMode: 'bounty',
        taskReward: '1000000',
        taskRequester: REQUESTER,
        submissionVisibility: 'public',
        ...overrides,
      };
    }

    it('shows a public-mode submission to any unauthenticated caller', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([myRow()]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe(TASK_ID);
    });

    it('hides a never-mode active-task submission from an unauthenticated caller', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'never', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toEqual([]);
    });

    it('still shows a never-mode submission to the worker themselves once ctx.caller proves it', async () => {
      const ctx = createMockCtx(undefined, { address: WORKER });
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'never', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
    });

    it('does not let an unrelated caller impersonate the worker via the workerAddress query param alone', async () => {
      const ctx = createMockCtx(undefined, { address: OTHER_WORKER });
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'never', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toEqual([]);
    });

    it("still shows a never-mode submission to that task's requester", async () => {
      const ctx = createMockCtx(undefined, { address: REQUESTER });
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'never', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
    });

    it('reveals a reveal_all submission to anyone once the task has ended', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'reveal_all', taskStatus: 'completed' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
    });

    it('hides a reveal_all submission from anyone while the task is still active', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'reveal_all', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toEqual([]);
    });

    it('reveals only the winner_only submissions the caller actually won, across multiple tasks', async () => {
      const ctx = createMockCtx();
      // Two rows, two different tasks -- both winner_only and ended, but only
      // one of them has this worker in task_awards.
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            myRow({ submissionVisibility: 'winner_only', taskStatus: 'completed' }),
            myRow({
              taskId: OTHER_TASK_ID,
              submissionVisibility: 'winner_only',
              taskStatus: 'completed',
            }),
          ])
        )
        // winningAddressesForTask(TASK_ID) -- this worker won.
        .mockReturnValueOnce(makeChain([{ workerAddress: WORKER }]))
        // winningAddressesForTask(OTHER_TASK_ID) -- someone else won.
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xSomeoneElse000000000000000000001' }]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe(TASK_ID);
    });
  });
});
