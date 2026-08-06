// Verifies: ADR-0042
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';

vi.mock('../../src/services/contract', () => ({
  contractCreateTask: vi.fn(),
  contractAssignEvaluator: vi.fn(),
  contractCancelTask: vi.fn(),
  contractRefundExpired: vi.fn(),
  contractUpdateTask: vi.fn(),
  contractRejectSubmission: vi.fn(),
  contractSubmitWork: vi.fn(),
  contractGetTaskHooks: vi.fn().mockResolvedValue([]),
  contractGetDreamsPerUsdc: vi.fn().mockResolvedValue(0n),
  contractGetDreamsWorkerSplitBps: vi.fn().mockResolvedValue(0),
  contractGetDreamsBonusBps: vi.fn().mockResolvedValue(0),
  MODE_MAP: {},
  AUCTION_SUBTYPE_MAP: {},
  precomputeTaskId: vi.fn(),
}));

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();
  return {
    ...actual,
    getServerConfig: vi.fn().mockReturnValue({
      DREAMS_HOOK_ADDRESS: undefined,
      OFFICIAL_TASK_DROP_OWNER_ADDRESSES: [],
    }),
  };
});

import { submissions, tasks } from '../../src/db/schema';
import { submissionsRouter } from '../../src/routers/submissions.router';
import { tasksRouter } from '../../src/routers/tasks.router';

const isolatedDatabase = createIsolatedMigratedDatabase('evaluator_evidence');
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const TASK_ID = 'private-evaluator-evidence-task';
const REQUESTER = '0x0000000000000000000000000000000000000001';
const EVALUATOR = '0x0000000000000000000000000000000000000002';
const RESOLVER = '0x0000000000000000000000000000000000000003';
const OUTSIDER = '0x0000000000000000000000000000000000000004';

function context(callerAddress?: string, payer?: string) {
  return {
    db: database,
    req: {},
    res: {
      locals: { payer },
      setHeader: vi.fn(),
      vary: vi.fn(),
    },
    caller: callerAddress ? { address: callerAddress } : undefined,
    taskAccessGrant: undefined,
  } as never;
}

describeWithDatabase('assigned evaluator evidence access (real DB)', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
    await database.insert(tasks).values({
      id: TASK_ID,
      requester: REQUESTER,
      requesterPubkey: REQUESTER,
      description: 'Private evaluator evidence',
      reward: '1000000',
      escrowTxHash: '0xevaluator-evidence',
      expiryTime: new Date(Date.now() + 86_400_000),
      status: 'open',
      tags: ['integration'],
      mode: 'bounty',
      taskVisibility: 'private',
      submissionVisibility: 'never',
      evaluator: EVALUATOR,
      disputeResolver: RESOLVER,
    });
    await database.insert(submissions).values([
      {
        id: 'private-evidence-1',
        taskId: TASK_ID,
        workerAddress: '0x0000000000000000000000000000000000000011',
        fileUrl: 'file://private-evidence-1',
        signature: '0xsignature1',
      },
      {
        id: 'private-evidence-2',
        taskId: TASK_ID,
        workerAddress: '0x0000000000000000000000000000000000000012',
        fileUrl: 'file://private-evidence-2',
        signature: '0xsignature2',
      },
    ]);
  });

  afterAll(() => isolatedDatabase.stop());

  it.each([
    ['evaluator', EVALUATOR],
    ['dispute resolver', RESOLVER],
  ])('lets the assigned %s directly read the private task and every never submission', async (_role, address) => {
    const task = await tasksRouter.createCaller(context(address)).get({ taskId: TASK_ID });
    const evidence = await submissionsRouter
      .createCaller(context(address))
      .listByTask({ taskId: TASK_ID });

    expect(task?.id).toBe(TASK_ID);
    expect(evidence.map((row) => row.id).sort()).toEqual([
      'private-evidence-1',
      'private-evidence-2',
    ]);
  });

  it('keeps the private task out of discovery and denies an unrelated authenticated caller', async () => {
    const list = await tasksRouter.createCaller(context(OUTSIDER)).list({ limit: 20 });
    const task = await tasksRouter.createCaller(context(OUTSIDER)).get({ taskId: TASK_ID });
    const evidence = await submissionsRouter
      .createCaller(context(OUTSIDER))
      .listByTask({ taskId: TASK_ID });

    expect(list.tasks.some((row) => row.id === TASK_ID)).toBe(false);
    expect(task).toBeNull();
    expect(evidence).toEqual([]);
  });

  it('does not turn evidence read access into requester mutation authority', async () => {
    await expect(
      tasksRouter.createCaller(context(EVALUATOR, EVALUATOR)).cancel({ taskId: TASK_ID })
    ).rejects.toThrow('Only the task requester can cancel');
  });

  it('revokes role-derived task and evidence access when assignments are cleared', async () => {
    await database
      .update(tasks)
      .set({ evaluator: null, disputeResolver: null })
      .where(eq(tasks.id, TASK_ID));

    for (const address of [EVALUATOR, RESOLVER]) {
      const task = await tasksRouter.createCaller(context(address)).get({ taskId: TASK_ID });
      const evidence = await submissionsRouter
        .createCaller(context(address))
        .listByTask({ taskId: TASK_ID });
      expect(task).toBeNull();
      expect(evidence).toEqual([]);
    }
  });
});
