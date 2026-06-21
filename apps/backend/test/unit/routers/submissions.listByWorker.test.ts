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
import { getStorageBackend } from '../../../src/lib/storage';

const WORKER = '0xWorker0000000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const SUB_ID = '00000000-0000-0000-0000-000000000001';

const completedRow = {
  taskId: TASK_ID,
  completedAt: new Date('2026-06-10T10:00:00Z'),
  description: 'Design a logo\nmore details on the next line',
};

const submissionRow = {
  id: SUB_ID,
  taskId: TASK_ID,
  workerAddress: WORKER,
  fileUrl: 'file://test/file',
  signature: '0xsig',
  deliverableHash: null,
  submitTxHash: null,
  submittedAt: new Date(),
};

const imageArtifactRow = {
  id: 'artifact-image',
  taskId: TASK_ID,
  submissionId: SUB_ID,
  role: 'final',
  fileName: 'logo.png',
  mimeType: 'image/png',
  mediaKind: 'image',
  storageUri: 'file://test/logo.png',
  sizeBytes: 100,
  sha256Hash: 'a'.repeat(64),
  keccak256Hash: `0x${'b'.repeat(64)}`,
  displayOrder: 1,
  createdAt: new Date(),
};

const textArtifactRow = {
  ...imageArtifactRow,
  id: 'artifact-text',
  fileName: 'notes.txt',
  mimeType: 'text/plain',
  mediaKind: 'text',
  storageUri: 'file://test/notes.txt',
  displayOrder: 0,
};

const agentRow = {
  address: WORKER,
  agentId: 'agent-one',
  completedTasks: 7,
  ratedTasks: 2,
  totalStars: 9,
};

describe('submissions router listByWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty array when the worker has no completed work', async () => {
    const ctx = createMockCtx();
    // feedbacks -> tasks join returns nothing.
    ctx.db.select.mockReturnValueOnce(makeChain([]));

    const caller = submissionsRouter.createCaller(ctx);
    const result = await caller.listByWorker({ address: WORKER });

    expect(result).toEqual([]);
    // No further queries are run once there is no accepted work.
    expect(ctx.db.select).toHaveBeenCalledTimes(1);
  });

  it('derives accepted work via the feedbacks join and returns artifacts newest first', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      // 1: feedbacks -> tasks (accepted/completed work)
      .mockReturnValueOnce(makeChain([completedRow]))
      // 2: worker submissions for those tasks
      .mockReturnValueOnce(makeChain([submissionRow]))
      // 3: artifacts for those submissions
      .mockReturnValueOnce(makeChain([imageArtifactRow, textArtifactRow]))
      // 4: worker agent lookup
      .mockReturnValueOnce(makeChain([agentRow]));

    const caller = submissionsRouter.createCaller(ctx);
    const result = await caller.listByWorker({ address: WORKER, includePreviewUrls: 'none' });

    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe(TASK_ID);
    // taskTitle is the first line of the description.
    expect(result[0].taskTitle).toBe('Design a logo');
    expect(result[0].completedAt).toBe('2026-06-10T10:00:00.000Z');
    // Artifacts are sorted by displayOrder (text=0 before image=1).
    expect(result[0].artifacts.map((artifact) => artifact.id)).toEqual([
      'artifact-text',
      'artifact-image',
    ]);
    expect(result[0].artifacts[0].workerAgentId).toBe('agent-one');
    expect(result[0].artifacts[0].workerAddress).toBe(WORKER);
    // No preview URLs requested.
    expect(JSON.stringify(result)).not.toContain('previewUrl');
  });

  it('includes presigned media preview URLs when requested (default behavior)', async () => {
    const storage = getStorageBackend();
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([completedRow]))
      .mockReturnValueOnce(makeChain([submissionRow]))
      .mockReturnValueOnce(makeChain([imageArtifactRow, textArtifactRow]))
      .mockReturnValueOnce(makeChain([agentRow]));

    const caller = submissionsRouter.createCaller(ctx);
    const result = await caller.listByWorker({ address: WORKER });

    // Only the image artifact gets a presigned preview URL (media-only).
    expect(storage.getPresignedUrl).toHaveBeenCalledTimes(1);
    expect(storage.getPresignedUrl).toHaveBeenCalledWith('file://test/logo.png', 3600);

    const imageResult = result[0].artifacts.find((artifact) => artifact.id === 'artifact-image');
    expect(imageResult).toEqual(
      expect.objectContaining({
        previewUrl: 'https://presigned.example.com/file',
        previewExpiresAt: expect.any(String),
      })
    );
    const textResult = result[0].artifacts.find((artifact) => artifact.id === 'artifact-text');
    expect(textResult).not.toHaveProperty('previewUrl');
  });

  it('returns the task with an empty artifacts list when the worker has no submission for it', async () => {
    const ctx = createMockCtx();
    ctx.db.select
      .mockReturnValueOnce(makeChain([completedRow]))
      // No worker submissions for the completed task.
      .mockReturnValueOnce(makeChain([]))
      // artifacts query is skipped (no submission ids), so next select is the agent lookup.
      .mockReturnValueOnce(makeChain([agentRow]));

    const caller = submissionsRouter.createCaller(ctx);
    const result = await caller.listByWorker({ address: WORKER });

    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe(TASK_ID);
    expect(result[0].artifacts).toEqual([]);
  });
});
