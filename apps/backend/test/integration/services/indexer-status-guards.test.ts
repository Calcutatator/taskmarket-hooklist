import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Verifies: ADR-0007 (indexer status transitions guarded by prior state)

// indexer.ts reads getServerConfig() eagerly at module scope (for the public
// RPC client and a few module-level constants), so importing it -- unlike
// every other test file, which only imports routers/services that call
// getServerConfig() lazily inside functions -- requires the full blockchain
// env (BASE_RPC_URL, CONTRACT_ADDRESS, FORWARDER_ADDRESS, USDC_TOKEN_ADDRESS,
// SERVER_PRIVATE_KEY) to be set or process.exit(1)s during module load. CI's
// test job only provisions DATABASE_URL (no live chain), so mock it here the
// same way acceptance.test.ts/evaluations.test.ts already do for the same
// reason. None of these values are read by the handlers under test.
vi.mock('../../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/env')>();

  return {
    ...actual,
    getServerConfig: vi.fn().mockReturnValue({
      BASE_RPC_URL: 'http://127.0.0.1:8545',
      CHAIN_ID: 84532,
      CONTRACT_ADDRESS: '0xD17485087c2d31bf5562ACf0C5295111982A1CBF',
      CONTRACT_DEPLOY_BLOCK: 0,
      DEFAULT_PLATFORM_FEE_BPS: 750,
      DREAMS_HOOK_ADDRESS: undefined,
      DREAMS_HOOK_SEED_BLOCK: 0,
      ERC8004_IDENTITY_REGISTRY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
      ERC8004_SEED_BLOCK: 0,
      FORWARDER_ADDRESS: '0xF07de5510087c7a3E01d977c6392e14C0Aa10dF7',
      SERVER_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
      USDC_TOKEN_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    }),
  };
});

import { bids, tasks } from '../../../src/db/schema';
import {
  processAuctionAcceptedEvent,
  processBidSubmittedEvent,
  processEvaluatorTimedOutEvent,
  processTaskAppealedEvent,
  processTaskCancelledEvent,
  processTaskClaimedEvent,
  processTaskCreatedEvent,
  processTaskEvaluatedEvent,
  processTaskExpiredEvent,
  processTaskReopenedEvent,
  processTaskSubmittedEvent,
  processTaskWorkerSelectedEvent,
} from '../../../src/services/indexer';
import { createIsolatedMigratedDatabase } from '../../helpers/integration-database';

// Covers ADR-0007's guarded indexer status handlers: each guarded UPDATE
// must apply from its documented valid prior state(s) and must silently
// no-op (not regress) from any other state, exactly reproducing -- in an
// isolated test database -- the live-observed bug this ADR closes (a stale
// TaskEvaluated event regressing a 'completed' task back to 'appealing').

const isolatedDatabase = createIsolatedMigratedDatabase('indexer_guards', { maxConnections: 12 });
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const WORKER = '0x1111111111111111111111111111111111111111';
const fakeBlockClient = { getBlock: async () => ({ timestamp: 1_700_000_000n }) };

const taskIds: string[] = [];

async function insertTask(overrides: Partial<typeof tasks.$inferInsert> = {}): Promise<string> {
  const id = `test-guard-${randomUUID()}`;
  taskIds.push(id);
  await database.insert(tasks).values({
    description: 'Indexer status guard integration test',
    escrowTxHash: `escrow-${id}`,
    expiryTime: new Date('2030-01-01T00:00:00.000Z'),
    id,
    mode: 'claim',
    requester: '0x0000000000000000000000000000000000000001',
    requesterPubkey: 'test-public-key',
    reward: '1000',
    status: 'open',
    tags: [],
    ...overrides,
  });
  return id;
}

async function statusOf(taskId: string): Promise<string> {
  const rows = await database
    .select({ status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0]!.status;
}

async function taskStateOf(taskId: string): Promise<{ claimedBy: string | null; status: string }> {
  const rows = await database
    .select({ claimedBy: tasks.claimedBy, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0]!;
}

async function evaluatedTaskStateOf(taskId: string): Promise<{
  appealDeadline: Date | null;
  claimedBy: string | null;
  expiryTime: Date;
  status: string;
}> {
  const rows = await database
    .select({
      appealDeadline: tasks.appealDeadline,
      claimedBy: tasks.claimedBy,
      expiryTime: tasks.expiryTime,
      status: tasks.status,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return rows[0]!;
}

describeWithDatabase('indexer status guard handlers', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterEach(async () => {
    for (const taskId of taskIds.splice(0)) {
      await database.delete(bids).where(eq(bids.taskId, taskId));
      await database.delete(tasks).where(eq(tasks.id, taskId));
    }
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('processTaskCreatedEvent sets contractAddress, chainId, and platformFeeBps from config', async () => {
    const taskId = `test-guard-${randomUUID()}`;
    taskIds.push(taskId);
    await processTaskCreatedEvent(
      {
        args: {
          taskId,
          requester: '0x0000000000000000000000000000000000000002',
          reward: 1000n,
          mode: '0xa81913a5',
          expiryTime: 1_900_000_000n,
        },
        eventName: 'TaskCreated',
        transactionHash: `0x${'a'.repeat(64)}`,
      },
      database
    );
    const rows = await database
      .select({
        contractAddress: tasks.contractAddress,
        chainId: tasks.chainId,
        platformFeeBps: tasks.platformFeeBps,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    expect(rows[0]?.contractAddress).toBe('0xD17485087c2d31bf5562ACf0C5295111982A1CBF');
    expect(rows[0]?.chainId).toBe(84532);
    expect(rows[0]?.platformFeeBps).toBe(750);
  });

  it('processTaskCreatedEvent is a no-op when the same event is replayed', async () => {
    // Verifies: ADR-0098
    // Verifies: ADR-0101
    //
    // The insert's ON CONFLICT is targeted at the primary key rather than left untargeted, so
    // that a reference-code collision surfaces as an error instead of being swallowed as
    // "already recorded" -- which would silently drop the task row and lose the chain event.
    // Narrowing the target must not cost the replay-safety a reseed depends on, so that is
    // asserted here rather than assumed.
    const taskId = `test-guard-${randomUUID()}`;
    taskIds.push(taskId);
    const log = {
      args: {
        taskId,
        requester: '0x0000000000000000000000000000000000000002',
        reward: 1000n,
        mode: '0xa81913a5',
        expiryTime: 1_900_000_000n,
      },
      eventName: 'TaskCreated',
      transactionHash: `0x${'c'.repeat(64)}` as `0x${string}`,
    };

    await processTaskCreatedEvent(log, database);
    const [first] = await database
      .select({ referenceCode: tasks.referenceCode })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    expect(first?.referenceCode).toMatch(/^TSK-[0-9A-HJKMNP-TV-Z]{8}$/);

    // Replaying must not throw, must not duplicate, and must not re-mint the public name --
    // someone may already have quoted the first one.
    await expect(processTaskCreatedEvent(log, database)).resolves.not.toThrow();

    const rows = await database
      .select({ referenceCode: tasks.referenceCode })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.referenceCode).toBe(first?.referenceCode);
  });

  it('processTaskCreatedEvent surfaces a genuinely conflicting escrow_tx_hash rather than swallowing it', async () => {
    // Verifies: ADR-0098
    // Verifies: ADR-0101
    //
    // The behaviour change from targeting the conflict at the primary key. Two *different* task
    // ids sharing one escrow transaction hash cannot happen -- one transaction creates one task,
    // so the id and the hash move together -- and if it ever did it would be data corruption
    // worth hearing about. Previously the untargeted ON CONFLICT discarded the row in silence.
    const sharedTxHash = `0x${'d'.repeat(64)}` as `0x${string}`;
    const firstTaskId = `test-guard-${randomUUID()}`;
    const secondTaskId = `test-guard-${randomUUID()}`;
    taskIds.push(firstTaskId, secondTaskId);

    const baseArgs = {
      requester: '0x0000000000000000000000000000000000000002',
      reward: 1000n,
      mode: '0xa81913a5',
      expiryTime: 1_900_000_000n,
    };

    await processTaskCreatedEvent(
      { args: { ...baseArgs, taskId: firstTaskId }, eventName: 'TaskCreated', transactionHash: sharedTxHash },
      database
    );

    await expect(
      processTaskCreatedEvent(
        {
          args: { ...baseArgs, taskId: secondTaskId },
          eventName: 'TaskCreated',
          transactionHash: sharedTxHash,
        },
        database
      )
    ).rejects.toThrow();
  });

  it('processTaskCreatedEvent defaults stakeRequired/stakeBps to 0 for a pre-rev014 TaskCreated log (no stake args)', async () => {
    // Simulates a log decoded against TASK_CREATED_EVENT_PRE_REV014 -- args has no
    // stakeRequired/stakeBps keys at all, not just falsy values. A full reseed replaying
    // pre-upgrade history must not throw or insert undefined for these columns.
    const taskId = `test-guard-${randomUUID()}`;
    taskIds.push(taskId);
    await processTaskCreatedEvent(
      {
        args: {
          taskId,
          requester: '0x0000000000000000000000000000000000000002',
          reward: 1000n,
          mode: '0xa81913a5',
          expiryTime: 1_900_000_000n,
        },
        eventName: 'TaskCreated',
        transactionHash: `0x${'b'.repeat(64)}`,
      },
      database
    );
    const rows = await database
      .select({ stakeRequired: tasks.stakeRequired, stakeBps: tasks.stakeBps })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    expect(rows[0]?.stakeRequired).toBe(0);
    expect(rows[0]?.stakeBps).toBe(0);
  });

  // Verifies: ADR-0029
  it('processTaskCreatedEvent decodes stakeRequired/stakeBps from the TaskCreated event (rev014, ADR-0029)', async () => {
    const taskId = `test-guard-${randomUUID()}`;
    taskIds.push(taskId);
    await processTaskCreatedEvent(
      {
        args: {
          taskId,
          requester: '0x0000000000000000000000000000000000000002',
          reward: 1000n,
          mode: '0xa81913a5',
          expiryTime: 1_900_000_000n,
          stakeRequired: true,
          stakeBps: 1500,
        },
        eventName: 'TaskCreated',
        transactionHash: `0x${'a'.repeat(64)}`,
      },
      database
    );
    const rows = await database
      .select({ stakeRequired: tasks.stakeRequired, stakeBps: tasks.stakeBps })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    expect(rows[0]?.stakeRequired).toBe(1);
    expect(rows[0]?.stakeBps).toBe(1500);
  });

  it('processTaskClaimedEvent applies from open, no-ops once already claimed', async () => {
    const openTaskId = await insertTask({ status: 'open' });
    await processTaskClaimedEvent(
      { args: { taskId: openTaskId, worker: WORKER, stakeAmount: 0n }, eventName: 'TaskClaimed' },
      database
    );
    expect(await statusOf(openTaskId)).toBe('claimed');

    const staleTaskId = await insertTask({ status: 'completed' });
    await processTaskClaimedEvent(
      { args: { taskId: staleTaskId, worker: WORKER, stakeAmount: 0n }, eventName: 'TaskClaimed' },
      database
    );
    expect(await statusOf(staleTaskId)).toBe('completed');
  });

  it('processTaskWorkerSelectedEvent sets worker_selected for pitch mode', async () => {
    const taskId = await insertTask({ status: 'open', mode: 'pitch' });
    await processTaskWorkerSelectedEvent(
      { args: { taskId, worker: WORKER }, eventName: 'TaskWorkerSelected' },
      database
    );
    expect(await statusOf(taskId)).toBe('worker_selected');
  });

  it('processTaskWorkerSelectedEvent sets claimed for auction mode (mode-blindness fix)', async () => {
    const taskId = await insertTask({ status: 'open', mode: 'auction' });
    await processTaskWorkerSelectedEvent(
      { args: { taskId, worker: WORKER }, eventName: 'TaskWorkerSelected' },
      database
    );
    expect(await statusOf(taskId)).toBe('claimed');
  });

  it('processTaskWorkerSelectedEvent no-ops once the task has advanced past open', async () => {
    const taskId = await insertTask({ status: 'worker_selected', mode: 'pitch' });
    await processTaskWorkerSelectedEvent(
      { args: { taskId, worker: WORKER }, eventName: 'TaskWorkerSelected' },
      database
    );
    expect(await statusOf(taskId)).toBe('worker_selected');
  });

  it('processTaskSubmittedEvent starts review from pending_approval, no-ops once appealing', async () => {
    const evaluatorTaskId = await insertTask({
      status: 'pending_approval',
      mode: 'claim',
      evaluator: '0x0000000000000000000000000000000000000002',
      evaluationWindow: 3600,
    });
    await processTaskSubmittedEvent(
      {
        args: { taskId: evaluatorTaskId, worker: WORKER, deliverable: '0xdead' },
        eventName: 'TaskSubmitted',
        blockNumber: 42n,
      },
      database,
      fakeBlockClient
    );
    expect(await statusOf(evaluatorTaskId)).toBe('review');

    const staleTaskId = await insertTask({
      status: 'appealing',
      mode: 'claim',
      evaluator: '0x0000000000000000000000000000000000000002',
      evaluationWindow: 3600,
    });
    await processTaskSubmittedEvent(
      {
        args: { taskId: staleTaskId, worker: WORKER, deliverable: '0xdead' },
        eventName: 'TaskSubmitted',
        blockNumber: 43n,
      },
      database,
      fakeBlockClient
    );
    expect(await statusOf(staleTaskId)).toBe('appealing');
  });

  it('processTaskExpiredEvent applies from open, no-ops once completed', async () => {
    const openTaskId = await insertTask({ status: 'open' });
    await processTaskExpiredEvent(
      { args: { taskId: openTaskId }, eventName: 'TaskExpired' },
      database
    );
    expect(await statusOf(openTaskId)).toBe('expired');

    const completedTaskId = await insertTask({ status: 'completed' });
    await processTaskExpiredEvent(
      { args: { taskId: completedTaskId }, eventName: 'TaskExpired' },
      database
    );
    expect(await statusOf(completedTaskId)).toBe('completed');
  });

  it('processTaskCancelledEvent applies from open, no-ops once claimed', async () => {
    const openTaskId = await insertTask({ status: 'open' });
    await processTaskCancelledEvent(
      { args: { taskId: openTaskId }, eventName: 'TaskCancelled' },
      database
    );
    expect(await statusOf(openTaskId)).toBe('cancelled');

    const claimedTaskId = await insertTask({ status: 'claimed' });
    await processTaskCancelledEvent(
      { args: { taskId: claimedTaskId }, eventName: 'TaskCancelled' },
      database
    );
    expect(await statusOf(claimedTaskId)).toBe('claimed');
  });

  it('processAuctionAcceptedEvent applies from open, no-ops once worker_selected', async () => {
    const openTaskId = await insertTask({ status: 'open', mode: 'auction' });
    await processAuctionAcceptedEvent(
      {
        args: { taskId: openTaskId, worker: WORKER, acceptedPrice: 1000n },
        eventName: 'AuctionAccepted',
      },
      database
    );
    expect(await statusOf(openTaskId)).toBe('claimed');

    const advancedTaskId = await insertTask({ status: 'worker_selected', mode: 'auction' });
    await processAuctionAcceptedEvent(
      {
        args: { taskId: advancedTaskId, worker: WORKER, acceptedPrice: 1000n },
        eventName: 'AuctionAccepted',
      },
      database
    );
    expect(await statusOf(advancedTaskId)).toBe('worker_selected');
  });

  it('processBidSubmittedEvent inserts a reconciliation row when the router has not written one yet', async () => {
    const taskId = await insertTask({ status: 'open', mode: 'auction' });
    await processBidSubmittedEvent(
      {
        args: { taskId, worker: WORKER, price: 1000n },
        eventName: 'BidSubmitted',
        transactionHash: `0x${'c'.repeat(64)}`,
      },
      database
    );
    const rows = await database
      .select({ id: bids.id, price: bids.price })
      .from(bids)
      .where(eq(bids.taskId, taskId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.price).toBe('1000');
    // A random id, not the event's transactionHash -- keeps bids.id UUID-shaped
    // regardless of whether the router or the indexer's insert lands first.
    expect(rows[0]?.id).not.toBe(`0x${'c'.repeat(64)}`);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('processBidSubmittedEvent does not throw or overwrite when bids.submit already won the race for this (taskId, worker)', async () => {
    // Reproduces the real race: bids.router.ts's own upsert lands first for a worker's
    // first bid on a task, keyed on the same bids_task_worker_unique (taskId,
    // workerAddress) constraint this handler's insert targets.
    const taskId = await insertTask({ status: 'open', mode: 'auction' });
    await database.insert(bids).values({
      id: 'router-written-bid',
      taskId,
      workerAddress: WORKER,
      price: '2000',
    });

    await expect(
      processBidSubmittedEvent(
        {
          args: { taskId, worker: WORKER, price: 1000n },
          eventName: 'BidSubmitted',
          transactionHash: `0x${'d'.repeat(64)}`,
        },
        database
      )
    ).resolves.not.toThrow();

    const rows = await database
      .select({ id: bids.id, price: bids.price })
      .from(bids)
      .where(eq(bids.taskId, taskId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('router-written-bid');
    expect(rows[0]?.price).toBe('2000');
  });

  it('processTaskReopenedEvent applies from claimed, no-ops once already open (the ABA-adjacent case)', async () => {
    const claimedTaskId = await insertTask({ status: 'claimed', claimedBy: WORKER });
    await processTaskReopenedEvent(
      { args: { taskId: claimedTaskId }, eventName: 'TaskReopened' },
      database
    );
    expect(await statusOf(claimedTaskId)).toBe('open');

    const openTaskId = await insertTask({ status: 'open' });
    await processTaskReopenedEvent(
      { args: { taskId: openTaskId }, eventName: 'TaskReopened' },
      database
    );
    expect(await statusOf(openTaskId)).toBe('open');
  });

  it('processTaskEvaluatedEvent applies from review, no-ops once completed -- reproduces the live-observed regression', async () => {
    const reviewTaskId = await insertTask({ appealWindow: 3600, status: 'review', mode: 'claim' });
    await processTaskEvaluatedEvent(
      {
        args: { taskId: reviewTaskId, verdictType: 0, score: 90 },
        blockNumber: 123n,
        eventName: 'TaskEvaluated',
      },
      database,
      undefined,
      fakeBlockClient
    );
    expect(await statusOf(reviewTaskId)).toBe('appealing');

    // This is the exact scenario ADR-0007 documents: finalizeVerdict's
    // synchronous all-zero-award write already completed the task; a
    // late-processed TaskEvaluated event from the earlier evaluate() call
    // must not regress it back to 'appealing'.
    const completedTaskId = await insertTask({ status: 'completed', mode: 'claim' });
    await processTaskEvaluatedEvent(
      { args: { taskId: completedTaskId, verdictType: 0, score: 90 }, eventName: 'TaskEvaluated' },
      database
    );
    expect(await statusOf(completedTaskId)).toBe('completed');
  });

  it('processTaskEvaluatedEvent restores a contest award worker from canonical chain state', async () => {
    const taskId = await insertTask({
      appealWindow: 3600,
      claimedBy: null,
      contractAddress: '0x2222222222222222222222222222222222222222',
      expiryTime: new Date('2023-01-01T00:00:00.000Z'),
      mode: 'bounty',
      status: 'open',
    });
    const readTaskWorker = vi.fn().mockResolvedValue(WORKER);

    await processTaskEvaluatedEvent(
      {
        args: { taskId, verdictType: 0, score: 90 },
        blockNumber: 123n,
        eventName: 'TaskEvaluated',
      },
      database,
      readTaskWorker,
      fakeBlockClient
    );

    expect(readTaskWorker).toHaveBeenCalledWith(
      taskId,
      '0x2222222222222222222222222222222222222222'
    );
    expect(await evaluatedTaskStateOf(taskId)).toEqual({
      appealDeadline: new Date('2023-11-14T23:13:20.000Z'),
      claimedBy: WORKER,
      expiryTime: new Date('2023-11-14T23:13:20.000Z'),
      status: 'appealing',
    });
  });

  it('processTaskEvaluatedEvent leaves task state unchanged when appeal timing RPC recovery fails', async () => {
    const expiryTime = new Date('2030-01-01T00:00:00.000Z');
    const taskId = await insertTask({
      appealWindow: 3600,
      claimedBy: null,
      expiryTime,
      mode: 'bounty',
      status: 'open',
    });
    const readTaskWorker = vi.fn().mockResolvedValue(WORKER);
    const failingBlockClient = {
      getBlock: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
    };

    await expect(
      processTaskEvaluatedEvent(
        {
          args: { taskId, verdictType: 0, score: 90 },
          blockNumber: 123n,
          eventName: 'TaskEvaluated',
        },
        database,
        readTaskWorker,
        failingBlockClient
      )
    ).rejects.toThrow('RPC unavailable');

    expect(await evaluatedTaskStateOf(taskId)).toEqual({
      appealDeadline: null,
      claimedBy: null,
      expiryTime,
      status: 'open',
    });
  });

  it('processTaskEvaluatedEvent does not read or restore contest ownership after status advanced', async () => {
    const taskId = await insertTask({ claimedBy: null, mode: 'benchmark', status: 'completed' });
    const readTaskWorker = vi.fn().mockResolvedValue(WORKER);

    await processTaskEvaluatedEvent(
      { args: { taskId, verdictType: 0, score: 90 }, eventName: 'TaskEvaluated' },
      database,
      readTaskWorker
    );

    expect(readTaskWorker).not.toHaveBeenCalled();
    expect(await taskStateOf(taskId)).toEqual({ claimedBy: null, status: 'completed' });
  });

  it('processTaskAppealedEvent applies from appealing, no-ops once completed', async () => {
    const appealingTaskId = await insertTask({ status: 'appealing' });
    await processTaskAppealedEvent(
      { args: { taskId: appealingTaskId }, eventName: 'TaskAppealed' },
      database
    );
    expect(await statusOf(appealingTaskId)).toBe('disputed');

    const completedTaskId = await insertTask({ status: 'completed' });
    await processTaskAppealedEvent(
      { args: { taskId: completedTaskId }, eventName: 'TaskAppealed' },
      database
    );
    expect(await statusOf(completedTaskId)).toBe('completed');
  });

  it('processEvaluatorTimedOutEvent applies from review, no-ops once appealing', async () => {
    const reviewTaskId = await insertTask({ status: 'review' });
    await processEvaluatorTimedOutEvent(
      { args: { taskId: reviewTaskId }, eventName: 'EvaluatorTimedOut' },
      database
    );
    expect(await statusOf(reviewTaskId)).toBe('pending_approval');

    const appealingTaskId = await insertTask({ status: 'appealing' });
    await processEvaluatorTimedOutEvent(
      { args: { taskId: appealingTaskId }, eventName: 'EvaluatorTimedOut' },
      database
    );
    expect(await statusOf(appealingTaskId)).toBe('appealing');
  });
});
