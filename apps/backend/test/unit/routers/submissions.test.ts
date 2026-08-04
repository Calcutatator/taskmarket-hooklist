import { createHash } from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIntentCtx, makeChain } from '../helpers';

vi.mock('../../../src/lib/storage', () => ({
  getStorageBackend: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue('file://test/submissions/task1/file'),
    getPresignedUrl: vi.fn().mockResolvedValue('https://presigned.example.com/file'),
    getPresignedUploadUrl: vi.fn().mockResolvedValue('https://presigned.example.com/upload'),
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

// Partial: the ceiling helpers and other exports must stay real, only the config lookup is
// stubbed -- it would otherwise process.exit on missing env now that a router pulls the
// logger in through the intent path.
vi.mock('../../../src/config/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/env')>()),
  getServerConfig: vi.fn().mockReturnValue({
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: '0xD17485087c2d31bf5562ACf0C5295111982A1CBF',
    DEFAULT_PLATFORM_FEE_BPS: 500,
  }),
}));

import { submissionsRouter } from '../../../src/routers/submissions.router';
import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildSubmitMessage } from '@taskmarket/shared';
import { envelopeForError } from '../../../src/lib/api-error';
import { getStorageBackend } from '../../../src/lib/storage';
import { contractSubmitWork } from '../../../src/services/contract';
import {
  artifacts as artifactsTable,
  submissions as submissionsTable,
  tasks as tasksTable,
} from '../../../src/db/schema';

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

  describe('submit - durable intent (ADR-0045)', () => {
    // Verifies: ADR-0045
    it('records a free intent before the chain call and completes it after', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));

      const result = await submissionsRouter.createCaller(ctx).submit(baseSubmitInput);

      expect(ctx.intents).toHaveLength(1);
      const intent = ctx.intents[0]!;
      expect(intent.operation).toBe('submissions.submit');
      // No payment reference: nothing about this write is refundable, and settlement must
      // never think otherwise.
      expect(intent.paymentTxHash).toBeNull();
      expect(intent.paymentAmount).toBeNull();
      // The payload carries everything the completion needs, so a reconciler pass finishing
      // this hours later writes the same submission the request would have.
      const payload = intent.payload as {
        artifacts: unknown[];
        deliverableHash: string;
        submissionId: string;
      };
      expect(payload.submissionId).toBe(result.submissionId);
      expect(payload.artifacts).toHaveLength(1);
      expect(payload.deliverableHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(intent.status).toBe('completed');
      expect(intent.txHash).toBe('0xsubmittx');
    });

    // Verifies: ADR-0045
    it('writes no submission row when the chain call never lands', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      vi.mocked(contractSubmitWork).mockRejectedValueOnce(new Error('TaskNotOpen'));
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));

      await expect(submissionsRouter.createCaller(ctx).submit(baseSubmitInput)).rejects.toThrow(
        'TaskNotOpen'
      );

      // The intent stays non-terminal -- only the chain writes a terminal state -- and no
      // submission exists for work the chain never accepted.
      expect(ctx.intents[0]!.status).toBe('recorded');
      expect(ctx.insertChain(submissionsTable).values).not.toHaveBeenCalled();
    });

    // Verifies: ADR-0045
    it('reports the ceiling in the error when recording the submission fails', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));
      ctx.insertChain(submissionsTable).values.mockImplementationOnce(() => {
        throw new Error('hard submission ceiling reached');
      });

      // The work is on chain, so this is not a failure to be refunded or retried by the
      // caller. The message has to say which of those it is, and name the ceiling, or a
      // worker at their limit is told only that something went wrong.
      await expect(submissionsRouter.createCaller(ctx).submit(baseSubmitInput)).rejects.toThrow(
        /committed on chain.*submission limit/s
      );
      // Left at `broadcast`, not `completed` and not `failed`: the transaction is on chain,
      // so the intent stays claimable and a later pass retries the recording.
      expect(ctx.intents[0]!.status).toBe('broadcast');
    });
  });

  describe('submit', () => {
    it('throws when task is not found', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Task not found');
    });

    it('submits to open bounty task and keeps it open', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));
      const submissionInsert = ctx.insertChain(submissionsTable);
      const artifactInsert = ctx.insertChain(artifactsTable);

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(typeof result.submissionId).toBe('string');
      expect(ctx.insertChain(submissionsTable).values).toHaveBeenCalledOnce();
      expect(ctx.insertChain(artifactsTable).values).toHaveBeenCalledOnce();
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
      expect(ctx.updateChain(tasksTable).set).not.toHaveBeenCalled();
    });

    it('submits multiple artifacts and anchors one manifest hash on chain', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const storage = getStorageBackend();
      vi.mocked(storage.upload)
        .mockResolvedValueOnce('file://test/submissions/task1/logo.png')
        .mockResolvedValueOnce('file://test/submissions/task1/source.svg');
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));
      const submissionInsert = ctx.insertChain(submissionsTable);
      const artifactInsert = ctx.insertChain(artifactsTable);

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
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));
      const tx: any = {
        select: vi.fn().mockReturnValue(makeChain([])),
        insert: vi.fn().mockReturnValue(makeChain()),
        update: vi.fn().mockReturnValue(makeChain()),
        execute: vi.fn().mockResolvedValue([]),
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
      // Verifies: ADR-0045 -- the submission and artifact rows are written by the completion
      // handler, inside its own transaction, and never outside one.
      expect(ctx.insertChain(submissionsTable).values).not.toHaveBeenCalled();
      expect(ctx.updateChain(tasksTable).set).not.toHaveBeenCalled();
    });

    it('submits to open benchmark task and keeps it open', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'benchmark', status: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      // Benchmark is an open contest like bounty: submitting must NOT flip status.
      expect(ctx.updateChain(tasksTable).set).not.toHaveBeenCalled();
    });

    it('accepts an additional submission to an open bounty without changing status', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(typeof result.submissionId).toBe('string');
      expect(ctx.insertChain(submissionsTable).values).toHaveBeenCalledOnce();
      expect(ctx.insertChain(artifactsTable).values).toHaveBeenCalledOnce();
      // Open contest stays open across submissions, so no task status update.
      expect(ctx.updateChain(tasksTable).set).not.toHaveBeenCalled();
    });

    it('submits to claimed claim task by correct worker', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: WORKER })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      // claim task flips to pending_approval after submission so requester can accept
      expect(ctx.updateChain(tasksTable).set).toHaveBeenCalledWith({ status: 'pending_approval' });
    });

    it('throws when claim task is not claimed', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'claim', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Task not claimed');
    });

    it('throws when claim task worker is a different worker (valid signature, still rejected)', async () => {
      // The claimedBy comparison now runs AFTER signature verification (pre-auth
      // oracle fix) -- a valid signature over WORKER must still be rejected when
      // WORKER isn't the task's assigned worker, same as before the reorder.
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: '0xOtherWorker' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Only worker can submit');
    });

    it('submits to pitch task by selected worker', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'pitch', status: 'worker_selected', claimedBy: WORKER })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.submit(baseSubmitInput);

      expect(result.success).toBe(true);
      // pitch task flips to pending_approval after submission so requester can accept
      expect(ctx.updateChain(tasksTable).set).toHaveBeenCalledWith({ status: 'pending_approval' });
    });

    it('throws when pitch task worker is different (valid signature, still rejected)', async () => {
      // Same reorder as the claim-mode case above: signature verification runs
      // before the claimedBy comparison now, but a valid signature over a
      // non-selected worker is still rejected.
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'pitch', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Worker not selected');
    });

    it('throws BAD_REQUEST when signature is invalid', async () => {
      vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Invalid signature');
    });

    it('throws UNAUTHORIZED when signature is from different address', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000001' as `0x${string}`
      );
      const ctx = createIntentCtx();
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
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Invalid signature');
      });

      it('rejects an unsigned candidate address with a signature error, not a claimedBy-mismatch error (pitch mode)', async () => {
        vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
        const ctx = createIntentCtx();
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
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'auction', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submit(baseSubmitInput)).rejects.toThrow('Invalid signature');
      });

      it('submits successfully for the winning bidder on an auction task once selected', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'auction', status: 'claimed', claimedBy: WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submit(baseSubmitInput);

        expect(result.success).toBe(true);
        // auction task flips to pending_approval after submission so requester can accept
        expect(ctx.updateChain(tasksTable).set).toHaveBeenCalledWith({
          status: 'pending_approval',
        });
      });

      it('rejects a valid-signature caller who is not the winning bidder on an auction task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createIntentCtx();
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
        const ctx = createIntentCtx();
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
        const ctx = createIntentCtx(undefined, undefined, { taskId: TASK_ID });
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
        const ctx = createIntentCtx();
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
        const ctx = createIntentCtx();
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

  describe('requestUploadUrl', () => {
    it('records which worker the issued artifactKey belongs to', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ status: 'open', mode: 'bounty', expiryTime: null }])
      );
      const insertChain = makeChain();
      ctx.db.insert.mockReturnValueOnce(insertChain);

      const caller = submissionsRouter.createCaller(ctx);
      await caller.requestUploadUrl({
        taskId: TASK_ID,
        workerAddress: WORKER,
        signature: '0xsig',
        fileName: 'submission.txt',
        mimeType: 'text/plain',
        sizeBytes: 123,
      });

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: TASK_ID, workerAddress: WORKER })
      );
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
        const ctx = createIntentCtx();
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
        const ctx = createIntentCtx(undefined, undefined, { taskId: TASK_ID });
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
        const ctx = createIntentCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([
              makeTask({
                mode: 'bounty',
                status: 'open',
                taskVisibility: 'private',
                claimedBy: WORKER,
              }),
            ])
          )
          .mockReturnValueOnce(makeChain([{ artifactKey: ARTIFACT_KEY, workerAddress: WORKER }]));

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submitFromKeys(baseFromKeysInput);

        expect(result.success).toBe(true);
      });

      it('allows an allowlisted viewer to submit to a private benchmark task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(ALLOWED_VIEWER as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'benchmark', status: 'open', taskVisibility: 'private' })])
          )
          .mockReturnValueOnce(makeChain([])) // task_awards: no match
          .mockReturnValueOnce(makeChain([{ viewerAddress: ALLOWED_VIEWER }]))
          .mockReturnValueOnce(
            makeChain([{ artifactKey: ARTIFACT_KEY, workerAddress: ALLOWED_VIEWER }])
          );

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
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submitFromKeys(baseFromKeysInput)).rejects.toThrow('Invalid signature');
      });

      it('rejects an unsigned candidate address with a signature error, not a claimedBy-mismatch error (pitch mode)', async () => {
        vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
        const ctx = createIntentCtx();
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
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'auction', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submitFromKeys(baseFromKeysInput)).rejects.toThrow('Invalid signature');
      });

      it('submits successfully for the pre-assigned worker on a claim task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: WORKER })])
          )
          .mockReturnValueOnce(makeChain([{ artifactKey: ARTIFACT_KEY, workerAddress: WORKER }]));

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submitFromKeys(baseFromKeysInput);

        expect(result.success).toBe(true);
      });

      it('rejects a valid-signature caller who is not the assigned worker on a claim task', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'claim', status: 'claimed', claimedBy: OTHER_WORKER })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submitFromKeys(baseFromKeysInput)).rejects.toThrow(
          'Only worker can submit'
        );
      });
    });

    describe('artifact key ownership', () => {
      const OTHER_WORKER = '0xOtherWorkerAddr00000000000000000000002';

      it('rejects an artifact key that was never issued via requestUploadUrl', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'bounty', status: 'open', claimedBy: null })])
          )
          .mockReturnValueOnce(makeChain([])); // pendingUploadKeys: no matching row at all

        const caller = submissionsRouter.createCaller(ctx);
        await expect(caller.submitFromKeys(baseFromKeysInput)).rejects.toThrow(
          'Artifact key was not issued to this worker'
        );
      });

      it('rejects an artifact key that was issued to a different worker', async () => {
        // Worker A's own key, presented by worker B -- the task-id prefix matches
        // (both requested a key for the same task), but the key was never theirs.
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(OTHER_WORKER as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'bounty', status: 'open', claimedBy: null })])
          )
          .mockReturnValueOnce(makeChain([{ artifactKey: ARTIFACT_KEY, workerAddress: WORKER }]));

        const caller = submissionsRouter.createCaller(ctx);
        await expect(
          caller.submitFromKeys({ ...baseFromKeysInput, workerAddress: OTHER_WORKER })
        ).rejects.toThrow('Artifact key was not issued to this worker');
      });

      it('allows the key when it was issued to the presenting worker', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select
          .mockReturnValueOnce(
            makeChain([makeTask({ mode: 'bounty', status: 'open', claimedBy: null })])
          )
          .mockReturnValueOnce(makeChain([{ artifactKey: ARTIFACT_KEY, workerAddress: WORKER }]));

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submitFromKeys(baseFromKeysInput);

        expect(result.success).toBe(true);
      });
    });
  });

  describe('content-binding (issue #323): signatures must be bound to submitted content', () => {
    // A real secp256k1 signer -- these tests need genuine signature/message binding,
    // not the blanket per-test `recoverMessageAddress` stub the rest of this file uses
    // (which returns a canned address regardless of the message argument, so it can't
    // tell a bound message from an unbound one).
    const SIGNER_ACCOUNT = privateKeyToAccount(`0x${'44'.repeat(32)}`);
    const SIGNER_ADDRESS = SIGNER_ACCOUNT.address;

    beforeEach(async () => {
      const actualViem = await vi.importActual<typeof import('viem')>('viem');
      vi.mocked(recoverMessageAddress).mockImplementation(actualViem.recoverMessageAddress);
    });

    afterEach(() => {
      vi.mocked(recoverMessageAddress).mockReset();
    });

    function artifactKeyInput(artifactKey: string, overrides: Record<string, any> = {}) {
      return {
        artifactKey,
        fileName: 'payload.txt',
        mimeType: 'text/plain',
        role: 'attachment' as const,
        sizeBytes: 10,
        sha256Hash: 'a'.repeat(64),
        keccak256Hash: `0x${'b'.repeat(64)}`,
        ...overrides,
      };
    }

    describe('submit (raw inline bytes)', () => {
      it('rejects a signature harvested from one submission when replayed with different bytes', async () => {
        // Today's message format has no content binding, so this is exactly what a
        // worker signs for a legitimate submission -- and, per issue #323, exactly
        // what an attacker could harvest (e.g. from listByTask's `signature` field)
        // and replay against completely different file bytes.
        const harvestedSignature = await SIGNER_ACCOUNT.signMessage({
          message: buildSubmitMessage(TASK_ID),
        });

        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'bounty', status: 'open' })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        await expect(
          caller.submit({
            taskId: TASK_ID,
            workerAddress: SIGNER_ADDRESS,
            signature: harvestedSignature,
            artifacts: [
              {
                fileName: 'payload.txt',
                mimeType: 'text/plain',
                role: 'attachment',
                file: Buffer.from('bytes the signature never authorized').toString('base64'),
              },
            ],
          })
        ).rejects.toThrow(/Signature does not match worker address|Invalid signature/);
      });

      it('accepts a submission whose signature is bound to the exact submitted bytes', async () => {
        const fileBytes = Buffer.from('exact submitted bytes');
        const contentHash = createHash('sha256').update(fileBytes).digest('hex');
        const signature = await SIGNER_ACCOUNT.signMessage({
          message: buildSubmitMessage(TASK_ID, [contentHash]),
        });

        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'bounty', status: 'open' })])
        );

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submit({
          taskId: TASK_ID,
          workerAddress: SIGNER_ADDRESS,
          signature,
          artifacts: [
            {
              fileName: 'payload.txt',
              mimeType: 'text/plain',
              role: 'attachment',
              file: fileBytes.toString('base64'),
            },
          ],
        });

        expect(result.success).toBe(true);
      });
    });

    describe('submitFromKeys', () => {
      it('rejects a signature harvested from one submission when replayed with different artifact keys', async () => {
        // Same replay as above, but for the presigned-upload flow: the signature
        // authorizes nothing about *which* keys get submitted under today's format.
        const harvestedSignature = await SIGNER_ACCOUNT.signMessage({
          message: buildSubmitMessage(TASK_ID),
        });

        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(
          makeChain([makeTask({ mode: 'bounty', status: 'open' })])
        );
        const storage = getStorageBackend();
        vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 10 });

        const caller = submissionsRouter.createCaller(ctx);
        await expect(
          caller.submitFromKeys({
            taskId: TASK_ID,
            workerAddress: SIGNER_ADDRESS,
            signature: harvestedSignature,
            artifacts: [artifactKeyInput(`submissions/${TASK_ID}/pending/never-authorized.txt`)],
          })
        ).rejects.toThrow(/Signature does not match worker address|Invalid signature/);
      });

      it('accepts a from-keys submission whose signature is bound to the exact artifact keys', async () => {
        const artifactKey = `submissions/${TASK_ID}/pending/payload.txt`;
        const signature = await SIGNER_ACCOUNT.signMessage({
          message: buildSubmitMessage(TASK_ID, [artifactKey]),
        });

        const ctx = createIntentCtx();
        ctx.db.select
          .mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]))
          // pendingUploadKeys: the key must be recorded as issued to this worker,
          // otherwise submitFromKeys rejects it before any content binding is checked.
          .mockReturnValueOnce(makeChain([{ artifactKey, workerAddress: SIGNER_ADDRESS }]));
        const storage = getStorageBackend();
        vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 10 });

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.submitFromKeys({
          taskId: TASK_ID,
          workerAddress: SIGNER_ADDRESS,
          signature,
          artifacts: [artifactKeyInput(artifactKey)],
        });

        expect(result.success).toBe(true);
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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

    describe('interactive HTML preview eligibility', () => {
      function mockSingleArtifactListing(htmlArtifactRow: Record<string, any>) {
        const ctx = createIntentCtx();
        ctx.db.select
          .mockReturnValueOnce(makeChain([makeTask()]))
          .mockReturnValueOnce(makeChain([submissionRow]))
          .mockReturnValueOnce(makeChain([htmlArtifactRow]))
          .mockReturnValueOnce(makeChain([]));
        return ctx;
      }

      it('gives a text/html artifact a preview URL from the listing path', async () => {
        const storage = getStorageBackend();
        const htmlArtifactRow = {
          ...artifactRow,
          id: 'artifact-html',
          fileName: 'game.html',
          mediaKind: 'text',
          mimeType: 'text/html',
          storageUri: 'file://test/game.html',
        };
        const ctx = mockSingleArtifactListing(htmlArtifactRow);

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.listByTask({
          includePreviewUrls: 'media',
          taskId: TASK_ID,
        });

        expect(storage.getPresignedUrl).toHaveBeenCalledWith('file://test/game.html', 3600);
        expect(result[0]?.artifacts[0]).toEqual(
          expect.objectContaining({
            id: 'artifact-html',
            previewUrl: 'https://presigned.example.com/file',
          })
        );
      });

      it('qualifies a parameterized text/html mimetype (text/html; charset=utf-8)', async () => {
        const storage = getStorageBackend();
        const htmlArtifactRow = {
          ...artifactRow,
          id: 'artifact-html-charset',
          fileName: 'game.html',
          mediaKind: 'text',
          mimeType: 'text/html; charset=utf-8',
          storageUri: 'file://test/game.html',
        };
        const ctx = mockSingleArtifactListing(htmlArtifactRow);

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.listByTask({
          includePreviewUrls: 'media',
          taskId: TASK_ID,
        });

        expect(storage.getPresignedUrl).toHaveBeenCalledWith('file://test/game.html', 3600);
        expect(result[0]?.artifacts[0]).toEqual(
          expect.objectContaining({
            id: 'artifact-html-charset',
            previewUrl: 'https://presigned.example.com/file',
          })
        );
      });

      it('qualifies a .html filename even with a generic mimetype', async () => {
        const storage = getStorageBackend();
        const htmlArtifactRow = {
          ...artifactRow,
          id: 'artifact-html-ext',
          fileName: 'INDEX.HTML',
          mediaKind: 'unknown',
          mimeType: 'application/octet-stream',
          storageUri: 'file://test/index.html',
        };
        const ctx = mockSingleArtifactListing(htmlArtifactRow);

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.listByTask({
          includePreviewUrls: 'media',
          taskId: TASK_ID,
        });

        expect(storage.getPresignedUrl).toHaveBeenCalledWith('file://test/index.html', 3600);
        expect(result[0]?.artifacts[0]).toEqual(
          expect.objectContaining({
            id: 'artifact-html-ext',
            previewUrl: 'https://presigned.example.com/file',
          })
        );
      });

      it('does not give a plain text artifact (text/plain, notes.txt) a preview URL', async () => {
        const storage = getStorageBackend();
        const textArtifactRow = {
          ...artifactRow,
          id: 'artifact-plain-text',
          fileName: 'notes.txt',
          mediaKind: 'text',
          mimeType: 'text/plain',
          storageUri: 'file://test/notes.txt',
        };
        const ctx = mockSingleArtifactListing(textArtifactRow);

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.listByTask({
          includePreviewUrls: 'media',
          taskId: TASK_ID,
        });

        expect(storage.getPresignedUrl).not.toHaveBeenCalled();
        expect(result[0]?.artifacts[0]).not.toHaveProperty('previewUrl');
      });

      it('does not give an archive artifact (application/zip) a preview URL', async () => {
        const storage = getStorageBackend();
        const zipArtifactRow = {
          ...artifactRow,
          id: 'artifact-zip',
          fileName: 'bundle.zip',
          mediaKind: 'archive',
          mimeType: 'application/zip',
          storageUri: 'file://test/bundle.zip',
        };
        const ctx = mockSingleArtifactListing(zipArtifactRow);

        const caller = submissionsRouter.createCaller(ctx);
        const result = await caller.listByTask({
          includePreviewUrls: 'media',
          taskId: TASK_ID,
        });

        expect(storage.getPresignedUrl).not.toHaveBeenCalled();
        expect(result[0]?.artifacts[0]).not.toHaveProperty('previewUrl');
      });
    });

    it('returns presigned URL when task is completed', async () => {
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('Submission not found');
    });

    it('throws when task is not completed', async () => {
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([submissionRow]))
        .mockReturnValueOnce(makeChain([makeTask({ status: 'open' })]));

      const caller = submissionsRouter.createCaller(ctx);
      await expect(
        caller.download({ submissionId: SUB_ID, acceptanceTxHash: '0xaccepttx' })
      ).rejects.toThrow('Task not completed');
    });

    it('rejects downloading a never-mode submission for an unauthenticated caller', async () => {
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx(undefined, { address: WORKER });
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx(undefined, { address: REQUESTER });
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([artifactRow]))
        .mockReturnValueOnce(makeChain([makeTask()]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      const result = await caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' });

      expect(result.previewUrl).toBe('https://presigned.example.com/file');
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects artifact preview requests with mismatched task IDs', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([{ ...artifactRow, taskId: '0xother' }]));

      const caller = submissionsRouter.createCaller(ctx) as any;
      await expect(
        caller.previewArtifact({ taskId: TASK_ID, artifactId: 'artifact-1' })
      ).rejects.toThrow('Task/artifact mismatch');
    });

    it('rejects previewing a never-mode artifact for an unauthenticated caller', async () => {
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx(undefined, { address: WORKER });
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([myRow()]));

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe(TASK_ID);
    });

    it('hides a never-mode active-task submission from an unauthenticated caller', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'never', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toEqual([]);
    });

    it('still shows a never-mode submission to the worker themselves once ctx.caller proves it', async () => {
      const ctx = createIntentCtx(undefined, { address: WORKER });
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'never', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
    });

    it('does not let an unrelated caller impersonate the worker via the workerAddress query param alone', async () => {
      const ctx = createIntentCtx(undefined, { address: OTHER_WORKER });
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'never', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toEqual([]);
    });

    it("still shows a never-mode submission to that task's requester", async () => {
      const ctx = createIntentCtx(undefined, { address: REQUESTER });
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'never', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
    });

    it('reveals a reveal_all submission to anyone once the task has ended', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'reveal_all', taskStatus: 'completed' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toHaveLength(1);
    });

    it('hides a reveal_all submission from anyone while the task is still active', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([myRow({ submissionVisibility: 'reveal_all', taskStatus: 'open' })])
      );

      const caller = submissionsRouter.createCaller(ctx);
      const result = await caller.mySubmissions({ workerAddress: WORKER });

      expect(result).toEqual([]);
    });

    it('reveals only the winner_only submissions the caller actually won, across multiple tasks', async () => {
      const ctx = createIntentCtx();
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

  describe('who pays for a paid submission', () => {
    const FUNDER = '0xFunder00000000000000000000000000000001';
    const FROM_KEYS_ARTIFACT_KEY = `submissions/${TASK_ID}/pending/submission.txt`;
    const fromKeysInput = {
      taskId: TASK_ID,
      workerAddress: WORKER,
      signature: '0xsig',
      artifacts: [
        {
          artifactKey: FROM_KEYS_ARTIFACT_KEY,
          fileName: 'submission.txt',
          mimeType: 'text/plain',
          role: 'attachment' as const,
          sizeBytes: 123,
          sha256Hash: 'a'.repeat(64),
          keccak256Hash: `0x${'b'.repeat(64)}`,
        },
      ],
    };

    /** What the x402 middleware publishes once it has settled a fee (ADR-0057). */
    function settlePayment(ctx: ReturnType<typeof createIntentCtx>, payer: string) {
      ctx.res.locals.payer = payer;
      ctx.res.locals.paymentAmount = '10000';
      ctx.res.locals.paymentTxHash = '0xpaymenttxhash';
    }

    // `vi.clearAllMocks` clears calls but not queued one-shot implementations, so a
    // `mockResolvedValueOnce` an earlier test never consumed would otherwise decide the head
    // size here. Restated per test rather than assumed.
    beforeEach(() => {
      vi.mocked(getStorageBackend().headObject)
        .mockReset()
        .mockResolvedValue({ contentLength: 123 });
    });

    function openTaskCtx(payerAddress?: string) {
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', status: 'open' })]))
        .mockReturnValueOnce(
          makeChain([{ artifactKey: FROM_KEYS_ARTIFACT_KEY, workerAddress: WORKER }])
        );
      if (payerAddress) settlePayment(ctx, payerAddress);
      return ctx;
    }

    // Verifies: ADR-0059
    it('accepts a paid submit whose fee the worker paid', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = openTaskCtx(WORKER);

      const result = await submissionsRouter.createCaller(ctx).submit(baseSubmitInput);

      expect(result.success).toBe(true);
      // The initiator ADR-0059 scopes `intents.get` to is now unambiguously the author of the
      // work: the settled payer and the signature-verified worker are the same address.
      expect(ctx.intents[0]!.payer).toBe(WORKER);
      expect(ctx.intents[0]!.paymentTxHash).toBe('0xpaymenttxhash');
    });

    // Verifies: ADR-0059
    it('refuses a paid submit funded by an address other than the worker', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = openTaskCtx(FUNDER);

      const error = await submissionsRouter
        .createCaller(ctx)
        .submit(baseSubmitInput)
        .catch((thrown: unknown) => thrown);

      expect(envelopeForError(error).reason).toBe('payment_payer_mismatch');
      // Refused before the intent exists, so nothing was broadcast and no row records a write
      // whose initiator is not its author.
      expect(ctx.intents).toHaveLength(0);
      expect(contractSubmitWork).not.toHaveBeenCalled();
    });

    // Verifies: ADR-0059
    it('leaves a free submit alone, since it has no payer to compare against', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      // No paymentAmount and no paymentTxHash: the RFC-0006 allowance path, which is most
      // submissions. `res.locals.payer` is set anyway, because anything that authenticates a
      // caller sets it -- so a check reading that field rather than the settled payment would
      // reject the common path outright.
      const ctx = openTaskCtx();
      ctx.res.locals.payer = FUNDER;

      const result = await submissionsRouter.createCaller(ctx).submit(baseSubmitInput);

      expect(result.success).toBe(true);
      expect(ctx.intents[0]!.paymentTxHash).toBeNull();
    });

    // Verifies: ADR-0059
    it('accepts a paid submitFromKeys whose fee the worker paid', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = openTaskCtx(WORKER);

      const result = await submissionsRouter.createCaller(ctx).submitFromKeys(fromKeysInput);

      expect(result.success).toBe(true);
      expect(ctx.intents[0]!.payer).toBe(WORKER);
    });

    // Verifies: ADR-0059
    it('refuses a paid submitFromKeys funded by an address other than the worker', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = openTaskCtx(FUNDER);

      const error = await submissionsRouter
        .createCaller(ctx)
        .submitFromKeys(fromKeysInput)
        .catch((thrown: unknown) => thrown);

      expect(envelopeForError(error).reason).toBe('payment_payer_mismatch');
      expect(ctx.intents).toHaveLength(0);
      expect(contractSubmitWork).not.toHaveBeenCalled();
    });

    // Verifies: ADR-0059
    it('leaves a free submitFromKeys alone', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = openTaskCtx();
      ctx.res.locals.payer = FUNDER;

      const result = await submissionsRouter.createCaller(ctx).submitFromKeys(fromKeysInput);

      expect(result.success).toBe(true);
      expect(ctx.intents[0]!.paymentTxHash).toBeNull();
    });
  });
});
