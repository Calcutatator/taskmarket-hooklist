// Verifies: ADR-0014 (public-by-default task visibility, unlisted/private opt-in)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createIntentCtx, createMockCtx, makeChain } from '../helpers';

// Mock contract service before importing router
vi.mock('../../../src/services/contract', () => ({
  contractAssignEvaluator: vi.fn().mockResolvedValue('0xassignhash'),
  contractCreateTask: vi.fn().mockResolvedValue('0xescrowhash'),
  contractUpdateTask: vi.fn().mockResolvedValue('0xupdatehash'),
  contractCancelTask: vi.fn().mockResolvedValue('0xcancelhash'),
  contractGetTaskHooks: vi.fn().mockResolvedValue([]),
  contractGetDreamsPerUsdc: vi.fn().mockResolvedValue(0n),
  contractGetDreamsWorkerSplitBps: vi.fn().mockResolvedValue(0),
  contractGetDreamsBonusBps: vi.fn().mockResolvedValue(0),
  contractRefundExpired: vi.fn().mockResolvedValue('0xrefundhash'),
  contractRefundOrphanedPayment: vi.fn().mockResolvedValue('0xrefundorphanhash'),
  // The id comes from the confirmed transaction's own TaskCreated log, so it is keyed on the
  // hash rather than fixed: nothing before the receipt knows it (ADR-0045).
  taskIdForTx: vi.fn().mockResolvedValue('0x' + 'a'.repeat(64)),
  MODE_MAP: {
    bounty: '0x00000001',
    claim: '0x00000002',
    pitch: '0x00000003',
    benchmark: '0x00000004',
    auction: '0x00000005',
  },
  AUCTION_SUBTYPE_MAP: {
    dutch: '0x00000011',
    english: '0x00000012',
    reverse_dutch: '0x00000013',
    reverse_english: '0x00000014',
  },
}));

// Mock the targeted new-task notifier so create() does not touch the mailer.
vi.mock('../../../src/services/task-notifications', () => ({
  notifyNewTask: vi.fn().mockResolvedValue({ sent: 0, failed: 0, total: 0 }),
}));

vi.mock('../../../src/services/task-drops-email', () => ({
  notifyTaskDropSubscribers: vi.fn().mockResolvedValue({ sent: 0, failed: 0, total: 0 }),
}));

// Mock config so no real env vars are needed
vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    DEFAULT_PLATFORM_FEE_BPS: 500,
    NODE_ENV: 'test',
    OFFICIAL_TASK_DROP_OWNER_ADDRESSES: ['0x1111111111111111111111111111111111111111'],
    CHAIN_ID: 84532,
    BASE_RPC_URL: 'http://localhost:8545',
    CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
    USDC_TOKEN_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    FEE_RECIPIENT_ADDRESS: '0x0000000000000000000000000000000000000002',
    DATABASE_URL: 'postgres://localhost/test',
    SERVER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
    X402_FACILITATOR_URL: 'https://facilitator.daydreams.systems',
    PORT: 3000,
  }),
}));

import { tasksRouter } from '../../../src/routers/tasks.router';
import { relayedIntents, taskDropTaskReservations, tasks } from '../../../src/db/schema';
import { ServerTransactionPendingError } from '../../../src/lib/server-transaction-dispatcher';
import {
  contractAssignEvaluator,
  contractCreateTask,
  contractUpdateTask,
  contractCancelTask,
  contractGetTaskHooks,
  contractGetDreamsPerUsdc,
  contractGetDreamsWorkerSplitBps,
  contractGetDreamsBonusBps,
  contractRefundExpired,
  contractRefundOrphanedPayment,
} from '../../../src/services/contract';
import { getServerConfig } from '../../../src/config/env';
import { notifyNewTask } from '../../../src/services/task-notifications';
import { notifyTaskDropSubscribers } from '../../../src/services/task-drops-email';

// Allow microtask-queued fire-and-forget work (notifyNewTask) to settle.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const PAYER = '0x1111111111111111111111111111111111111111';
const DROP_ID = 'drop-1';
const EVALUATOR = '0x2222222222222222222222222222222222222222';

const baseTaskInput = {
  description: 'Test task',
  reward: '1000000',
  duration: 7,
  tags: ['test'],
  mode: 'bounty' as const,
  stakeRequired: false,
  stakeBps: 0,
};

/**
 * Verifies: ADR-0045, ADR-0047
 *
 * create() now records a durable intent before the chain call and runs its post-receipt work
 * through the intent registry, which claims the row with a conditional UPDATE and reads the
 * payload back. Neither survives the default empty chains, and insert order is no longer a
 * reliable way to reach a particular table, so this context keeps a tiny in-memory intent
 * store and hands out one memoised chain per table.
 */
const createTaskCtx = createIntentCtx;

const mockTaskRow = {
  id: '0xabc',
  requester: PAYER,
  requesterPubkey: PAYER,
  description: 'Test task',
  reward: '1000000',
  escrowTxHash: '0xescrowhash',
  createdAt: new Date('2024-01-01'),
  expiryTime: new Date('2024-01-08'),
  status: 'open',
  tags: ['test'],
  mode: 'bounty',
  taskVisibility: 'unlisted',
  submissionVisibility: 'public',
  verdictType: null,
  stakeRequired: 0,
  stakeBps: 0,
  pitchDeadline: null,
  metricDescription: null,
  metricTarget: null,
  claimedBy: null,
  claimedAt: null,
  platformFeeBps: 500,
};

describe('tasks router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('throws when payer is missing', async () => {
      const ctx = createTaskCtx(); // no payer
      const caller = tasksRouter.createCaller(ctx);
      await expect(caller.create(baseTaskInput)).rejects.toThrow('Payment required: missing payer');
    });

    it('creates task and returns taskId on valid input', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create(baseTaskInput);

      expect(contractCreateTask).toHaveBeenCalledOnce();
      // The durable intent (ADR-0045) plus the task row itself.
      expect(ctx.db.insert).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(typeof result.taskId).toBe('string');
      expect(result.taskId.startsWith('0x')).toBe(true);
      expect(result.taskDropId).toBeNull();
    });

    it('passes mode to contractCreateTask', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      await caller.create({ ...baseTaskInput, mode: 'claim' });

      const [, , , mode] = vi.mocked(contractCreateTask).mock.calls[0];
      expect(mode).toBe('0x00000002'); // MODE_MAP.claim
    });

    it('passes stakeRequired/stakeBps to contractCreateTask', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      await caller.create({ ...baseTaskInput, stakeRequired: true, stakeBps: 1500 });

      const [, , , , , , , stakeRequired, stakeBps] = vi.mocked(contractCreateTask).mock.calls[0];
      expect(stakeRequired).toBe(true);
      expect(stakeBps).toBe(1500);
    });

    it('defaults stakeRequired/stakeBps to false/0 for contractCreateTask when unset', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      const {
        stakeRequired: _stakeRequired,
        stakeBps: _stakeBps,
        ...inputWithoutStake
      } = baseTaskInput;
      await caller.create(inputWithoutStake);

      const [, , , , , , , stakeRequired, stakeBps] = vi.mocked(contractCreateTask).mock.calls[0];
      expect(stakeRequired).toBe(false);
      expect(stakeBps).toBe(0);
    });

    it('fires targeted new-task notifications and skips Task Drops email without a drop', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create(baseTaskInput);

      expect(result.success).toBe(true);
      expect(notifyNewTask).toHaveBeenCalledOnce();
      const [arg] = vi.mocked(notifyNewTask).mock.calls[0];
      expect(arg.taskId).toBe(result.taskId);
      expect(arg.description).toBe(baseTaskInput.description);
      expect(arg.reward).toBe(baseTaskInput.reward);
      expect(arg.mode).toBe('bounty');
      expect(arg.tags).toEqual(baseTaskInput.tags);
      expect(notifyTaskDropSubscribers).not.toHaveBeenCalled();
    });

    it('attaches an owned existing drop and notifies only that drop', async () => {
      const ctx = createTaskCtx(PAYER);
      const dropChain = makeChain([{ announcedAt: null, id: DROP_ID, ownerAddress: PAYER }]);
      ctx.db.select.mockReturnValueOnce(dropChain).mockReturnValueOnce(makeChain([]));
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create({ ...baseTaskInput, taskDropId: DROP_ID });

      expect(result.success).toBe(true);
      expect(result.taskDropId).toBe(DROP_ID);
      expect(ctx.db.transaction).toHaveBeenCalledTimes(2);
      expect(notifyTaskDropSubscribers).toHaveBeenCalledOnce();
      expect(vi.mocked(notifyTaskDropSubscribers).mock.calls[0][0]).toEqual(
        expect.objectContaining({
          db: ctx.db,
          description: baseTaskInput.description,
          mode: 'bounty',
          reward: baseTaskInput.reward,
          tags: baseTaskInput.tags,
          taskId: result.taskId,
          taskDropId: DROP_ID,
        })
      );
    });

    it('reserves the drop before chain settlement and clears it with task persistence', async () => {
      const ctx = createTaskCtx(PAYER);
      const dropChain = makeChain([{ announcedAt: null, id: DROP_ID, ownerAddress: PAYER }]);
      const reservationInsert = ctx.insertChain(taskDropTaskReservations);
      ctx.db.select.mockReturnValueOnce(dropChain).mockReturnValueOnce(makeChain([]));
      const caller = tasksRouter.createCaller(ctx);

      await caller.create({ ...baseTaskInput, taskDropId: DROP_ID });

      expect(ctx.db.transaction).toHaveBeenCalledTimes(2);
      expect(dropChain.for).toHaveBeenCalledWith('update');
      // Its own identifier, not the task's: the reservation has to exist before the chain
      // call, and no task id exists until that call confirms.
      expect(reservationInsert.values).toHaveBeenCalledWith({
        reservationId: expect.stringMatching(/^res_/),
        taskDropId: DROP_ID,
      });
      expect(ctx.db.delete).toHaveBeenCalledOnce();

      // insert order: drop reservation, relayed intent, then the task row itself.
      const reservationOrder = ctx.db.insert.mock.invocationCallOrder[0];
      const intentOrder = ctx.db.insert.mock.invocationCallOrder[1];
      const chainOrder = vi.mocked(contractCreateTask).mock.invocationCallOrder[0];
      const taskInsertOrder = ctx.db.insert.mock.invocationCallOrder[2];
      expect(reservationOrder).toBeLessThan(intentOrder);
      // The intent is durable before anything reaches the chain (ADR-0045).
      expect(intentOrder).toBeLessThan(chainOrder);
      expect(chainOrder).toBeLessThan(taskInsertOrder);
    });

    it('reuses the reservation created by the X402 preflight', async () => {
      const ctx = createTaskCtx(PAYER);
      ctx.res.locals.taskDropReservation = {
        id: 'reservation-preflight',
        taskDropId: DROP_ID,
      };
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = tasksRouter.createCaller(ctx);

      await caller.create({ ...baseTaskInput, taskDropId: DROP_ID });

      expect(ctx.db.transaction).toHaveBeenCalledOnce();
      expect(ctx.db.insert).toHaveBeenCalledTimes(2);
      expect(ctx.db.delete).toHaveBeenCalledOnce();
      expect(contractCreateTask).toHaveBeenCalledOnce();
    });

    it('rejects attaching another requester owned drop', async () => {
      const ctx = createTaskCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ id: DROP_ID, ownerAddress: '0x2222222222222222222222222222222222222222' }])
      );
      const caller = tasksRouter.createCaller(ctx);

      await expect(caller.create({ ...baseTaskInput, taskDropId: DROP_ID })).rejects.toThrow(
        'Task drop is not owned by payer'
      );

      expect(contractCreateTask).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
      expect(notifyTaskDropSubscribers).not.toHaveBeenCalled();
    });

    it('rejects adding a task to an announced official drop', async () => {
      const ctx = createTaskCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          {
            announcedAt: new Date('2026-07-15T00:00:00.000Z'),
            id: DROP_ID,
            ownerAddress: PAYER,
          },
        ])
      );
      const caller = tasksRouter.createCaller(ctx);

      await expect(caller.create({ ...baseTaskInput, taskDropId: DROP_ID })).rejects.toThrow(
        'Official task drop has already been announced'
      );

      expect(contractCreateTask).not.toHaveBeenCalled();
      expect(ctx.db.insert).not.toHaveBeenCalled();
    });

    it('creates an inline drop owned by the payer and attaches the task', async () => {
      const ctx = createTaskCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create({
        ...baseTaskInput,
        taskDropCreate: { name: 'Documentation QA', description: 'Recurring docs tasks' },
      });

      expect(result.success).toBe(true);
      expect(result.taskDropId).toMatch(/^drop_/);
      // Relayed intent, inline drop, task row.
      expect(ctx.db.insert).toHaveBeenCalledTimes(3);
      expect(notifyTaskDropSubscribers).toHaveBeenCalledOnce();
      expect(vi.mocked(notifyTaskDropSubscribers).mock.calls[0][0].taskDropId).toBe(
        result.taskDropId
      );
    });

    it('passes task tags through to the notifier for skill targeting', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      await caller.create({ ...baseTaskInput, tags: ['design', 'logo'] });

      const [arg] = vi.mocked(notifyNewTask).mock.calls[0];
      expect(arg.tags).toEqual(['design', 'logo']);
      expect(notifyTaskDropSubscribers).not.toHaveBeenCalled();
    });

    it('persists visibility from input, defaulting to public', async () => {
      const ctx = createTaskCtx(PAYER);
      const taskInsert = ctx.insertChain(tasks);
      const caller = tasksRouter.createCaller(ctx);

      await caller.create(baseTaskInput);

      expect(taskInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({ taskVisibility: 'public' })
      );
    });

    it('persists an unlisted visibility choice and skips outbound notifications', async () => {
      const ctx = createTaskCtx(PAYER);
      const taskInsert = ctx.insertChain(tasks);
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create({ ...baseTaskInput, taskVisibility: 'unlisted' });

      expect(result.success).toBe(true);
      expect(taskInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({ taskVisibility: 'unlisted' })
      );
      // Unlisted tasks opt out of Taskmarket's own discovery surfaces (ADR-0014),
      // including outbound notifications -- see tasks.router.ts's create mutation.
      expect(notifyNewTask).not.toHaveBeenCalled();
      expect(notifyTaskDropSubscribers).not.toHaveBeenCalled();
    });

    it('still returns success when the notification send fails (fire-and-forget)', async () => {
      vi.mocked(notifyNewTask).mockRejectedValueOnce(new Error('mailer down'));
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create(baseTaskInput);

      expect(result.success).toBe(true);
      expect(typeof result.taskId).toBe('string');
      // The fire-and-forget rejection is swallowed by the router's .catch handler.
      await flushAsync();
      expect(notifyNewTask).toHaveBeenCalledOnce();
      expect(notifyTaskDropSubscribers).not.toHaveBeenCalled();
    });

    // Verifies: ADR-0045
    it('records evaluator assignment as its own intent before relaying it', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create({
        ...baseTaskInput,
        evaluator: EVALUATOR,
      });

      expect(result.success).toBe(true);
      // The contract's createTask cannot take evaluator configuration, so the assignment is a
      // second contract call. It gets a durable record of its own before it is sent, and is
      // then sent immediately -- assignEvaluator reverts once a worker claims the task, so
      // deferring it to a poll loses the race.
      const assignIntent = ctx.intents.find((row) => row.operation === 'tasks.assignEvaluator');
      expect(assignIntent).toBeDefined();
      // The fake intent store applies every update to its most recent row, so the status
      // assertion belongs to the create intent; the assignment's own broadcast is asserted by
      // the relay call and the linked hash.
      expect(contractAssignEvaluator).toHaveBeenCalledOnce();
      expect(assignIntent!.txHash).toBe('0xassignhash');
      // It carries no payment reference: nothing was paid for it, so a confirmed failure of it
      // has nothing to refund.
      expect(assignIntent!.paymentTxHash).toBeNull();
      expect(assignIntent!.payload).toEqual(
        expect.objectContaining({
          assignment: expect.objectContaining({ evaluator: EVALUATOR }),
          taskId: result.taskId,
        })
      );
    });

    // Verifies: ADR-0048
    describe('a failed create never decides the payment is orphaned', () => {
      const PAYMENT_TX_HASH = '0xpaymenttxhash';

      it('propagates the chain failure unchanged and leaves the refund to settlement', async () => {
        vi.mocked(contractCreateTask).mockRejectedValueOnce(
          new Error('Contract call rejected: EnforcedPause')
        );
        const ctx = createTaskCtx(PAYER);
        ctx.res.locals.paymentTxHash = PAYMENT_TX_HASH;
        const caller = tasksRouter.createCaller(ctx);

        await expect(caller.create(baseTaskInput)).rejects.toThrow(/EnforcedPause/);

        // Whether this payment is orphaned is decided by relayed-intent-settlement.ts from a
        // confirmed on-chain verdict, never here: this catch also fires on a receipt timeout,
        // where the transaction is live and refunding would pay for work that still lands.
        expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
        // Only the relayed intent, recorded before the chain call; no task row, no ledger row.
        expect(ctx.db.insert).toHaveBeenCalledOnce();
        // Left claimable rather than marked failed: only the chain writes a terminal state.
        expect(ctx.intents[0]!.status).toBe('recorded');
        expect(ctx.intents[0]!.paymentTxHash).toBe(PAYMENT_TX_HASH);
        // The payment reference is on the intent, which is what settlement refunds from.
        expect(ctx.intents[0]!.paymentAmount).toBe(baseTaskInput.reward);
      });

      it('does not attempt a refund when createTask fails but no payment ever settled', async () => {
        vi.mocked(contractCreateTask).mockRejectedValueOnce(new Error('unknown revert'));
        const ctx = createTaskCtx(PAYER);
        // No ctx.res.locals.paymentTxHash set.
        const caller = tasksRouter.createCaller(ctx);

        await expect(caller.create(baseTaskInput)).rejects.toThrow('unknown revert');

        expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
        expect(ctx.db.insert).toHaveBeenCalledOnce();
      });
    });

    // Verifies: ADR-0045
    describe('pending on-chain outcome', () => {
      it('never refunds and never persists a task when the escrow is still in flight', async () => {
        vi.mocked(contractCreateTask).mockRejectedValueOnce(
          new ServerTransactionPendingError('0xpendinghash', 7)
        );
        const ctx = createTaskCtx(PAYER);
        ctx.res.locals.paymentTxHash = '0xpaymenttxhash';
        const caller = tasksRouter.createCaller(ctx);

        await expect(caller.create(baseTaskInput)).rejects.toThrow(/remains in flight/);

        // "We stopped waiting" is not "it failed": the transaction is live and the
        // reconciler owns the outcome, so refunding here could pay for work that lands.
        expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
        expect(ctx.db.insert).toHaveBeenCalledOnce();
        expect(notifyNewTask).not.toHaveBeenCalled();
        // The intent is linked to the broadcast so the reconciler can complete it later.
        expect(ctx.intents[0]!.status).toBe('broadcast');
        expect(ctx.intents[0]!.txHash).toBe('0xpendinghash');
      });

      it('keeps the task drop reservation held while the escrow is still in flight', async () => {
        vi.mocked(contractCreateTask).mockRejectedValueOnce(
          new ServerTransactionPendingError('0xpendinghash', 8)
        );
        const ctx = createTaskCtx(PAYER);
        ctx.db.select
          .mockReturnValueOnce(makeChain([{ announcedAt: null, id: DROP_ID, ownerAddress: PAYER }]))
          .mockReturnValueOnce(makeChain([]));
        const caller = tasksRouter.createCaller(ctx);

        await expect(caller.create({ ...baseTaskInput, taskDropId: DROP_ID })).rejects.toThrow(
          /remains in flight/
        );

        // Releasing it would let another task take the slot a still-live escrow may fill.
        expect(ctx.db.delete).not.toHaveBeenCalled();
      });
    });

    describe('chain-event indexer race', () => {
      // services/indexer.ts's processTaskCreatedEvent also inserts a row for this id on
      // the on-chain TaskCreated event (onConflictDoNothing on its side), with only
      // on-chain-derivable fields populated, and can win the race against this insert.
      it('upserts on conflict with the indexer instead of failing on a duplicate id', async () => {
        const ctx = createTaskCtx(PAYER);
        const taskInsert = ctx.insertChain(tasks);
        const caller = tasksRouter.createCaller(ctx);

        const result = await caller.create({
          ...baseTaskInput,
          taskVisibility: 'private',
          submissionVisibility: 'winner_only',
          accessPassword: 'super-secret-password',
        });

        expect(result.success).toBe(true);
        expect(taskInsert.onConflictDoUpdate).toHaveBeenCalledOnce();
        const [{ target, set }] = vi.mocked(taskInsert.onConflictDoUpdate).mock.calls[0];
        expect(target).toBeDefined();
        // Off-chain-only fields must be patched in on conflict, or a private/winner_only
        // task silently falls back to the indexer's public/public defaults.
        expect(set).toEqual(
          expect.objectContaining({
            description: baseTaskInput.description,
            taskVisibility: 'private',
            submissionVisibility: 'winner_only',
            privateAccessPasswordHash: expect.any(String),
          })
        );
        // Fields owned by other event handlers, or already derived by the indexer from
        // the same on-chain event, must never be part of this merge.
        expect(set).not.toHaveProperty('status');
        expect(set).not.toHaveProperty('claimedBy');
        expect(set).not.toHaveProperty('claimedAt');
        expect(set).not.toHaveProperty('hookContract');
        expect(set).not.toHaveProperty('reward');
        expect(set).not.toHaveProperty('escrowTxHash');
        expect(set).not.toHaveProperty('stakeRequired');
        expect(set).not.toHaveProperty('stakeBps');
      });
    });
  });

  describe('get', () => {
    it('returns null when task is not found', async () => {
      const ctx = createMockCtx();
      // First select (task lookup) returns empty array
      ctx.db.select.mockReturnValueOnce(makeChain([]));
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.get({ taskId: '0xnotfound' });
      expect(result).toBeNull();
    });

    it('returns task with counts when found', async () => {
      const ctx = createMockCtx();
      // task lookup → Promise.all(submissionCount, pitchCount, requesterAgentRow) → latestSubmission
      ctx.db.select
        .mockReturnValueOnce(makeChain([mockTaskRow]))
        .mockReturnValueOnce(makeChain([{ count: 3 }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(mockTaskRow.id);
      expect(result!.submissionCount).toBe(3);
      expect(result!.pitchCount).toBe(1);
      // Regression: get() must return the stored visibility, not silently drop it.
      expect(result!.taskVisibility).toBe('unlisted');
    });

    it('resolves worker and requester agents without address case sensitivity', async () => {
      const requester = `0x${'Aa'.repeat(20)}`;
      const worker = `0x${'Bb'.repeat(20)}`;
      const workerAgentQuery = makeChain([{ agentId: 'worker-agent', registeredVia: 'cli' }]);
      const requesterAgentQuery = makeChain([{ registeredVia: 'web', publicKey: null }]);
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ ...mockTaskRow, requester, claimedBy: worker }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(workerAgentQuery)
        .mockReturnValueOnce(requesterAgentQuery)
        .mockReturnValueOnce(makeChain([]));

      const result = await tasksRouter.createCaller(ctx).get({ taskId: '0xabc' });

      expect(result?.workerAgentId).toBe('worker-agent');
      expect(result?.requesterActorType).toBe('human');

      const dialect = new PgDialect();
      const workerLookup = dialect.sqlToQuery(workerAgentQuery.where.mock.calls[0][0]);
      const requesterLookup = dialect.sqlToQuery(requesterAgentQuery.where.mock.calls[0][0]);
      expect(workerLookup.sql).toContain('lower("agents"."address") = lower($1)');
      expect(requesterLookup.sql).toContain('lower("agents"."address") = lower($1)');
    });

    it('returns ordered awards and one pending rating action per unrated winner', async () => {
      const primary = '0x0000000000000000000000000000000000000002';
      const secondary = '0x0000000000000000000000000000000000000003';
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([{ ...mockTaskRow, status: 'completed', claimedBy: primary }])
        )
        .mockReturnValueOnce(makeChain([{ count: 2 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ agentId: 'primary-agent', registeredVia: 'cli' }]))
        .mockReturnValueOnce(makeChain([{ registeredVia: 'web', publicKey: null }]))
        .mockReturnValueOnce(
          makeChain([
            {
              workerAddress: primary,
              workerAgentId: 'primary-agent',
              workerRegisteredVia: 'cli',
              rank: 1,
              workerPayment: '570000',
              platformFee: '30000',
              settlementTxHash: '0xsettlement',
              settledAt: new Date('2026-07-14T00:00:00.000Z'),
              rating: 92,
            },
            {
              workerAddress: secondary,
              workerAgentId: null,
              workerRegisteredVia: null,
              rank: 2,
              workerPayment: '380000',
              platformFee: '20000',
              settlementTxHash: '0xsettlement',
              settledAt: new Date('2026-07-14T00:00:00.000Z'),
              rating: null,
            },
          ])
        );

      const result = await tasksRouter.createCaller(ctx).get({ taskId: '0xabc' });

      expect(result?.awardCount).toBe(2);
      expect(result?.awards).toEqual([
        expect.objectContaining({
          workerAddress: primary,
          rank: 1,
          isPrimary: true,
          grossAmount: '600000',
          workerPayment: '570000',
          platformFee: '30000',
          rating: 92,
        }),
        expect.objectContaining({
          workerAddress: secondary,
          rank: 2,
          isPrimary: false,
          grossAmount: '400000',
          rating: null,
        }),
      ]);
      expect(result?.pendingActions.filter((action) => action.action === 'rate')).toEqual([
        expect.objectContaining({ targetWorker: secondary }),
      ]);
    });

    it('emits only forfeit for an expired claimed claim-mode task', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([{ ...mockTaskRow, mode: 'claim', status: 'claimed', claimedBy: '0xworker' }])
        )
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result).not.toBeNull();
      const actions = result!.pendingActions;
      expect(actions.some((a) => a.action === 'forfeit' && a.role === 'requester')).toBe(true);
      expect(actions.some((a) => a.action === 'submit' && a.role === 'worker')).toBe(false);
    });

    it('does not emit forfeit for a claimed bounty (non-claim mode)', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([{ ...mockTaskRow, mode: 'bounty', status: 'claimed', claimedBy: '0xworker' }])
        )
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result).not.toBeNull();
      expect(result!.pendingActions.some((a) => a.action === 'forfeit')).toBe(false);
    });

    it('omits all DREAMS estimate fields when the hook is not configured', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([mockTaskRow]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.dreamsPerUsdc).toBeUndefined();
      expect(result!.bonusBps).toBeUndefined();
      expect(result!.estimatedUsdBonusValue).toBeUndefined();
      expect(result!.estimatedWorkerUsdBonusValue).toBeUndefined();
      expect(result!.estimatedRequesterUsdBonusValue).toBeUndefined();
      expect(result!.estimatedWorkerDreamsBonus).toBeUndefined();
      expect(result!.estimatedRequesterDreamsBonus).toBeUndefined();
      expect(contractGetDreamsPerUsdc).not.toHaveBeenCalled();
    });

    it('includes worker and requester DREAMS estimates when the hook is attached', async () => {
      const DREAMS_HOOK = '0x1234567890123456789012345678901234567890';
      vi.mocked(getServerConfig).mockReturnValueOnce({
        DEFAULT_PLATFORM_FEE_BPS: 500,
        NODE_ENV: 'test',
        CHAIN_ID: 84532,
        BASE_RPC_URL: 'http://localhost:8545',
        CONTRACT_ADDRESS: '0x0000000000000000000000000000000000000001',
        USDC_TOKEN_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        FEE_RECIPIENT_ADDRESS: '0x0000000000000000000000000000000000000002',
        DATABASE_URL: 'postgres://localhost/test',
        SERVER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
        X402_FACILITATOR_URL: 'https://facilitator.daydreams.systems',
        PORT: 3000,
        DREAMS_HOOK_ADDRESS: DREAMS_HOOK,
      } as unknown as ReturnType<typeof getServerConfig>);
      vi.mocked(contractGetTaskHooks).mockResolvedValueOnce([DREAMS_HOOK as `0x${string}`]);
      vi.mocked(contractGetDreamsPerUsdc).mockResolvedValueOnce(10n * BigInt(10 ** 18));
      vi.mocked(contractGetDreamsWorkerSplitBps).mockResolvedValueOnce(8000);
      vi.mocked(contractGetDreamsBonusBps).mockResolvedValueOnce(750);

      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([mockTaskRow]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.dreamsPerUsdc).toBe((10n * BigInt(10 ** 18)).toString());
      expect(result!.bonusBps).toBe(750);
      // reward 1_000_000 (1 USDC) * 7.5% bonus = $0.075 USD bonus value (75000 base units)
      expect(result!.estimatedUsdBonusValue).toBe('75000');
      // 80% worker / 20% requester split of the $0.075 bonus
      expect(result!.estimatedWorkerUsdBonusValue).toBe('60000');
      expect(result!.estimatedRequesterUsdBonusValue).toBe('15000');
      // $0.075 * 10 DREAMS/USDC = 0.75 DREAMS total, split 80/20 = 0.6 / 0.15 DREAMS
      expect(result!.estimatedWorkerDreamsBonus).toBe((6n * BigInt(10 ** 17)).toString());
      expect(result!.estimatedRequesterDreamsBonus).toBe((15n * BigInt(10 ** 16)).toString());
    });
  });

  describe('submissionWindowOpen', () => {
    it('is true for an active open bounty', async () => {
      const ctx = createMockCtx();
      const activeRow = {
        ...mockTaskRow,
        status: 'open',
        expiryTime: new Date(Date.now() + 72 * 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([activeRow]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.submissionWindowOpen).toBe(true);
    });

    it('is false for an expired open bounty', async () => {
      const ctx = createMockCtx();
      const expiredRow = {
        ...mockTaskRow,
        status: 'open',
        expiryTime: new Date(Date.now() - 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([expiredRow]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.submissionWindowOpen).toBe(false);
    });

    it('is true for an active claimed claim task', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            {
              ...mockTaskRow,
              mode: 'claim',
              status: 'claimed',
              claimedBy: '0xworker',
              expiryTime: new Date(Date.now() + 3600 * 1000),
            },
          ])
        )
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.submissionWindowOpen).toBe(true);
    });

    it('expired bounty with submissions: omits submit, keeps accept', async () => {
      const ctx = createMockCtx();
      const expiredRowWithSubs = {
        ...mockTaskRow,
        status: 'open',
        expiryTime: new Date(Date.now() - 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([expiredRowWithSubs]))
        .mockReturnValueOnce(makeChain([{ count: 2 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.submissionWindowOpen).toBe(false);
      expect(result!.pendingActions.some((a) => a.action === 'accept')).toBe(true);
      expect(result!.pendingActions.some((a) => a.action === 'submit')).toBe(false);
    });

    it('active bounty with submissions: shows both submit and accept', async () => {
      const ctx = createMockCtx();
      const activeRowWithSubs = {
        ...mockTaskRow,
        status: 'open',
        expiryTime: new Date(Date.now() + 72 * 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([activeRowWithSubs]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.submissionWindowOpen).toBe(true);
      expect(result!.pendingActions.some((a) => a.action === 'accept')).toBe(true);
      expect(result!.pendingActions.some((a) => a.action === 'submit')).toBe(true);
    });

    it('active bounty under submissionVisibility public: pendingActions commands reveal the real submitter address', async () => {
      const ctx = createMockCtx();
      const activeRowWithSubs = {
        ...mockTaskRow,
        status: 'open',
        submissionVisibility: 'public',
        expiryTime: new Date(Date.now() + 72 * 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([activeRowWithSubs]))
        .mockReturnValueOnce(makeChain([{ count: 1 }])) // submissionCount
        .mockReturnValueOnce(makeChain([{ count: 0 }])) // pitchCount
        .mockReturnValueOnce(makeChain([])) // requesterAgentRow
        .mockReturnValueOnce(makeChain([])) // awardRows
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }])); // latestSubmission

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      const accept = result!.pendingActions.find((a) => a.action === 'accept');
      expect(accept?.command).toContain('0xworker');
    });

    // Verifies: ADR-0027
    it('active bounty with two distinct submitters: pendingActions commands omit any suggested address (ADR-0027)', async () => {
      const ctx = createMockCtx();
      const activeRowWithSubs = {
        ...mockTaskRow,
        status: 'open',
        submissionVisibility: 'public',
        expiryTime: new Date(Date.now() + 72 * 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([activeRowWithSubs])) // task row
        .mockReturnValueOnce(makeChain([{ count: 2 }])) // submissionCount
        .mockReturnValueOnce(makeChain([{ count: 0 }])) // pitchCount
        .mockReturnValueOnce(makeChain([])) // requesterAgentRow
        .mockReturnValueOnce(makeChain([])) // awardRows
        .mockReturnValueOnce(
          makeChain([{ workerAddress: '0xworkerA' }, { workerAddress: '0xworkerB' }])
        ); // distinct submitters -- ambiguous

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      const accept = result!.pendingActions.find((a) => a.action === 'accept');
      const rejectSubmission = result!.pendingActions.find((a) => a.action === 'reject_submission');
      expect(accept?.command).toContain('<address>');
      expect(accept?.command).not.toContain('0xworkerA');
      expect(accept?.command).not.toContain('0xworkerB');
      expect(rejectSubmission?.command).toContain('<address>');
      expect(rejectSubmission?.command).not.toContain('0xworkerA');
      expect(rejectSubmission?.command).not.toContain('0xworkerB');
    });

    it('active bounty under submissionVisibility never: pendingActions commands hide the submitter address from an anonymous caller', async () => {
      const ctx = createMockCtx();
      const activeRowWithSubs = {
        ...mockTaskRow,
        status: 'open',
        submissionVisibility: 'never',
        expiryTime: new Date(Date.now() + 72 * 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([activeRowWithSubs]))
        .mockReturnValueOnce(makeChain([{ count: 1 }])) // submissionCount
        .mockReturnValueOnce(makeChain([{ count: 0 }])) // pitchCount
        .mockReturnValueOnce(makeChain([])) // requesterAgentRow
        .mockReturnValueOnce(makeChain([])) // awardRows
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }])); // latestSubmission

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      const accept = result!.pendingActions.find((a) => a.action === 'accept');
      const rejectSubmission = result!.pendingActions.find((a) => a.action === 'reject_submission');
      expect(accept?.command).not.toContain('0xworker');
      expect(accept?.command).toContain('<address>');
      expect(rejectSubmission?.command).not.toContain('0xworker');
    });

    it('active bounty under submissionVisibility never: pendingActions commands still reveal the address to the requester', async () => {
      const ctx = createMockCtx(undefined, { address: mockTaskRow.requester });
      const activeRowWithSubs = {
        ...mockTaskRow,
        status: 'open',
        submissionVisibility: 'never',
        expiryTime: new Date(Date.now() + 72 * 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([activeRowWithSubs]))
        .mockReturnValueOnce(makeChain([{ count: 1 }])) // submissionCount
        .mockReturnValueOnce(makeChain([{ count: 0 }])) // pitchCount
        .mockReturnValueOnce(makeChain([])) // requesterAgentRow
        .mockReturnValueOnce(makeChain([])) // awardRows
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }])); // latestSubmission

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      const accept = result!.pendingActions.find((a) => a.action === 'accept');
      expect(accept?.command).toContain('0xworker');
    });

    it('pitch task after pitchDeadline: no pitch action, select_worker still present', async () => {
      const ctx = createMockCtx();
      const pitchRow = {
        ...mockTaskRow,
        mode: 'pitch',
        status: 'open',
        expiryTime: new Date(Date.now() + 72 * 3600 * 1000),
        pitchDeadline: new Date(Date.now() - 3600 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([pitchRow]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 2 }]))
        .mockReturnValueOnce(makeChain([]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.submissionWindowOpen).toBe(false);
      expect(result!.pendingActions.some((a) => a.action === 'pitch')).toBe(false);
      expect(result!.pendingActions.some((a) => a.action === 'select_worker')).toBe(true);
    });
  });

  describe('update', () => {
    // A bounty stays `open` while collecting submissions, so the requester can keep
    // editing it the whole time -- no pending_approval lock-out.
    const openBountyRow = {
      ...mockTaskRow,
      status: 'open',
      expiryTime: new Date(Date.now() + 72 * 60 * 60 * 1000),
    };

    it('allows off-chain metadata edits while a bounty has submissions and is open', async () => {
      const ctx = createMockCtx(PAYER);
      // task lookup -> updated task lookup -> submission count -> pitch count
      ctx.db.select
        .mockReturnValueOnce(makeChain([openBountyRow]))
        .mockReturnValueOnce(makeChain([{ ...openBountyRow, description: 'fixed title' }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.update({ taskId: '0xabc', description: 'fixed title' });

      expect(ctx.db.update).toHaveBeenCalledOnce();
      expect(result).not.toBeNull();
      expect(result!.description).toBe('fixed title');
    });

    it('allows reward/expiry changes while a bounty is open', async () => {
      const ctx = createTaskCtx(PAYER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([openBountyRow]))
        // linkIntentToBroadcast resolves the outbox row from the transaction hash, so the
        // intent the reconciler settles against is the one this request broadcast.
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ ...openBountyRow, reward: '5000000' }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.update({ taskId: '0xabc', reward: '5000000' });

      expect(contractUpdateTask).toHaveBeenCalledOnce();
      expect(result!.reward).toBe('5000000');
    });

    // Verifies: ADR-0048
    it('never persists the reward change, and never refunds, when the on-chain update fails', async () => {
      // The reward/expiry change must not be written to the DB when the on-chain update
      // reverted, or the DB and chain go permanently out of sync. The refund is a separate
      // question, and no longer this handler's to answer: the payment reference lives on the
      // intent, and settlement decides from the reconciler's verdict (ADR-0048).
      vi.mocked(contractUpdateTask).mockRejectedValueOnce(
        new Error('Contract call rejected: EnforcedPause')
      );
      const ctx = createTaskCtx(PAYER);
      ctx.res.locals.paymentTxHash = '0xpaymenttxhash';
      ctx.db.select.mockReturnValueOnce(makeChain([openBountyRow]));
      const caller = tasksRouter.createCaller(ctx);

      await expect(caller.update({ taskId: '0xabc', reward: '5000000' })).rejects.toThrow(
        /EnforcedPause/
      );

      expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
      expect(ctx.updateChain(tasks).set).not.toHaveBeenCalled();
      // computeUpdatePaymentAmount(currentReward='1000000', requestedReward='5000000')
      // = STANDARD_X402_ACTION_AMOUNT (1000) + the 4000000 increase. Recorded on the intent,
      // which is what settlement would refund from.
      expect(ctx.intents[0]!.paymentAmount).toBe('4001000');
      expect(ctx.intents[0]!.status).toBe('recorded');
    });

    it('returns the stored taskVisibility after an unrelated field update', async () => {
      const ctx = createMockCtx(PAYER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([openBountyRow]))
        .mockReturnValueOnce(makeChain([{ ...openBountyRow, description: 'fixed title' }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.update({ taskId: '0xabc', description: 'fixed title' });

      // Regression: update() must return the stored visibility, not silently drop it.
      expect(result!.taskVisibility).toBe('unlisted');
    });

    it('masks the latest submitter address in pendingActions commands under submissionVisibility never for an anonymous caller', async () => {
      const ctx = createMockCtx(PAYER);
      const neverRow = { ...openBountyRow, submissionVisibility: 'never' };
      ctx.db.select
        .mockReturnValueOnce(makeChain([neverRow]))
        .mockReturnValueOnce(makeChain([neverRow]))
        .mockReturnValueOnce(makeChain([{ count: 1 }])) // updatedSubmissionCount
        .mockReturnValueOnce(makeChain([{ count: 0 }])) // updatedPitchCount
        .mockReturnValueOnce(makeChain([])) // updatedRequesterAgent
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }])); // updatedLatestSubmission

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.update({ taskId: '0xabc' });

      const accept = result!.pendingActions.find((a) => a.action === 'accept');
      expect(accept?.command).not.toContain('0xworker');
      expect(accept?.command).toContain('<address>');
    });

    it('still reveals the latest submitter address in pendingActions commands under submissionVisibility never to the requester', async () => {
      const ctx = createMockCtx(PAYER, { address: PAYER });
      const neverRow = { ...openBountyRow, submissionVisibility: 'never' };
      ctx.db.select
        .mockReturnValueOnce(makeChain([neverRow]))
        .mockReturnValueOnce(makeChain([neverRow]))
        .mockReturnValueOnce(makeChain([{ count: 1 }])) // updatedSubmissionCount
        .mockReturnValueOnce(makeChain([{ count: 0 }])) // updatedPitchCount
        .mockReturnValueOnce(makeChain([])) // updatedRequesterAgent
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }])); // updatedLatestSubmission

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.update({ taskId: '0xabc' });

      const accept = result!.pendingActions.find((a) => a.action === 'accept');
      expect(accept?.command).toContain('0xworker');
    });

    it('omits the suggested worker in pendingActions commands once two distinct submitters exist (ADR-0027)', async () => {
      const ctx = createMockCtx(PAYER, { address: PAYER });
      ctx.db.select
        .mockReturnValueOnce(makeChain([openBountyRow]))
        .mockReturnValueOnce(makeChain([openBountyRow]))
        .mockReturnValueOnce(makeChain([{ count: 2 }])) // updatedSubmissionCount
        .mockReturnValueOnce(makeChain([{ count: 0 }])) // updatedPitchCount
        .mockReturnValueOnce(makeChain([])) // updatedRequesterAgent
        .mockReturnValueOnce(
          makeChain([{ workerAddress: '0xworkerA' }, { workerAddress: '0xworkerB' }])
        ); // updatedDistinctSubmitters -- ambiguous

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.update({ taskId: '0xabc' });

      const accept = result!.pendingActions.find((a) => a.action === 'accept');
      expect(accept?.command).toContain('<address>');
      expect(accept?.command).not.toContain('0xworkerA');
      expect(accept?.command).not.toContain('0xworkerB');
    });

    it('rejects update once a task has left open', async () => {
      const ctx = createMockCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ ...mockTaskRow, status: 'pending_approval' }])
      );

      const caller = tasksRouter.createCaller(ctx);
      await expect(caller.update({ taskId: '0xabc', description: 'too late' })).rejects.toThrow(
        'Task not open'
      );
    });

    it('keeps auction maxPrice equal to reward when reward changes', async () => {
      const auction = {
        ...openBountyRow,
        mode: 'auction',
        auctionType: 'english',
        maxPrice: openBountyRow.reward,
      };
      const ctx = createTaskCtx(PAYER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([auction]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        // The outbox lookup linkIntentToBroadcast makes after the chain call.
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ ...auction, reward: '5000000', maxPrice: '5000000' }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.update({ taskId: '0xabc', reward: '5000000' });

      expect(ctx.updateChain(tasks).set).toHaveBeenCalledWith(
        expect.objectContaining({ reward: '5000000', maxPrice: '5000000' })
      );
      expect(result?.maxPrice).toBe('5000000');
    });

    it('rejects lowering auction reward below its stored clock boundary', async () => {
      const auction = {
        ...openBountyRow,
        mode: 'auction',
        auctionType: 'dutch',
        maxPrice: '1000000',
        auctionFloorPrice: '800000',
      };
      const ctx = createMockCtx(PAYER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([auction]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      await expect(
        tasksRouter.createCaller(ctx).update({ taskId: '0xabc', reward: '700000' })
      ).rejects.toThrow('auctionFloorPrice must be <= reward');
      expect(contractUpdateTask).not.toHaveBeenCalled();
    });

    it('surfaces accept and submit actions for an open bounty with submissions', async () => {
      const ctx = createMockCtx();
      const openRowWithSubs = {
        ...mockTaskRow,
        status: 'open',
        expiryTime: new Date(Date.now() + 72 * 60 * 60 * 1000),
      };
      // get order: task -> Promise.all(submissionCount, pitchCount, requesterAgentRow) -> latestSubmission
      ctx.db.select
        .mockReturnValueOnce(makeChain([openRowWithSubs]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      const actions = result!.pendingActions;
      expect(actions.some((a) => a.action === 'accept' && a.role === 'requester')).toBe(true);
      expect(actions.some((a) => a.action === 'submit' && a.role === 'worker')).toBe(true);
      expect(actions.some((a) => a.action === 'cancel' && a.role === 'requester')).toBe(false);
    });

    it('does not surface accept for an open bounty with no submissions', async () => {
      const ctx = createMockCtx();
      const openRowNoSubs = {
        ...mockTaskRow,
        status: 'open',
        expiryTime: new Date(Date.now() + 72 * 60 * 60 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([openRowNoSubs]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.pendingActions.some((a) => a.action === 'accept')).toBe(false);
    });

    it('surfaces accept for an expired open bounty that still has submissions', async () => {
      const ctx = createMockCtx();
      const expiredRowWithSubs = {
        ...mockTaskRow,
        status: 'open',
        expiryTime: new Date(Date.now() - 60 * 60 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([expiredRowWithSubs]))
        .mockReturnValueOnce(makeChain([{ count: 2 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ workerAddress: '0xworker' }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(
        result!.pendingActions.some((a) => a.action === 'accept' && a.role === 'requester')
      ).toBe(true);
    });

    it('offers extension and refund for an expired open bounty with no submissions', async () => {
      const ctx = createMockCtx();
      const expiredRowNoSubs = {
        ...mockTaskRow,
        status: 'open',
        expiryTime: new Date(Date.now() - 60 * 60 * 1000),
      };
      ctx.db.select
        .mockReturnValueOnce(makeChain([expiredRowNoSubs]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.pendingActions.map((action) => action.action)).toEqual([
        'update',
        'refund_expired',
      ]);
      expect(result!.pendingActions.every((action) => action.role === 'requester')).toBe(true);
    });
  });

  describe('cancel', () => {
    it('rejects cancelling an open bounty with active submissions', async () => {
      const ctx = createMockCtx(PAYER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ ...mockTaskRow, status: 'open' }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]));

      const caller = tasksRouter.createCaller(ctx);
      await expect(caller.cancel({ taskId: '0xabc' })).rejects.toThrow('Active submissions exist');

      expect(contractCancelTask).not.toHaveBeenCalled();
    });

    it('allows cancelling an open bounty with no active submissions', async () => {
      const ctx = createTaskCtx(PAYER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ ...mockTaskRow, status: 'open' }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.cancel({ taskId: '0xabc' });

      expect(contractCancelTask).toHaveBeenCalledOnce();
      expect(result.txHash).toBe('0xcancelhash');
    });

    it('rejects cancelling a task that has left open', async () => {
      const ctx = createMockCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([{ ...mockTaskRow, mode: 'claim', status: 'claimed' }])
      );

      const caller = tasksRouter.createCaller(ctx);
      await expect(caller.cancel({ taskId: '0xabc' })).rejects.toThrow('Task not open');
      expect(contractCancelTask).not.toHaveBeenCalled();
    });
  });

  describe('refundExpired', () => {
    it('allows an expired locked-worker task with a submitted deliverable', async () => {
      const ctx = createTaskCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          {
            ...mockTaskRow,
            mode: 'claim',
            status: 'pending_approval',
            expiryTime: new Date(Date.now() - 60_000),
          },
        ])
      );

      const result = await tasksRouter.createCaller(ctx).refundExpired({ taskId: '0xabc' });

      expect(contractRefundExpired).toHaveBeenCalledOnce();
      expect(result.txHash).toBe('0xrefundhash');
      // The task lookup, plus linkIntentToBroadcast's outbox lookup after the chain call.
      expect(ctx.db.select).toHaveBeenCalledTimes(2);
    });

    // Verifies: ADR-0026
    it('allows a non-requester payer to refund an expired task (permissionless)', async () => {
      const NON_REQUESTER = '0x2222222222222222222222222222222222222222';
      const ctx = createTaskCtx(NON_REQUESTER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          {
            ...mockTaskRow,
            mode: 'claim',
            status: 'pending_approval',
            expiryTime: new Date(Date.now() - 60_000),
          },
        ])
      );

      const result = await tasksRouter.createCaller(ctx).refundExpired({ taskId: '0xabc' });

      expect(contractRefundExpired).toHaveBeenCalledOnce();
      expect(result.txHash).toBe('0xrefundhash');
    });

    it('blocks an expired contest while active submissions remain', async () => {
      const ctx = createMockCtx(PAYER);
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            {
              ...mockTaskRow,
              status: 'open',
              expiryTime: new Date(Date.now() - 60_000),
            },
          ])
        )
        .mockReturnValueOnce(makeChain([{ count: 1 }]));

      await expect(
        tasksRouter.createCaller(ctx).refundExpired({ taskId: '0xabc' })
      ).rejects.toThrow('Task has active submissions');
      expect(contractRefundExpired).not.toHaveBeenCalled();
    });
  });

  describe('create auction validation', () => {
    it('throws when auction mode is missing maxPrice', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      await expect(
        caller.create({ ...baseTaskInput, mode: 'auction', auctionType: 'english' })
      ).rejects.toThrow('maxPrice is required for auction mode');
    });

    it('throws when auction mode is missing auctionType', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      await expect(
        caller.create({ ...baseTaskInput, mode: 'auction', maxPrice: '1000000' })
      ).rejects.toThrow('auctionType is required for auction mode');
    });

    it('throws when auction maxPrice differs from escrow reward', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      await expect(
        caller.create({
          ...baseTaskInput,
          mode: 'auction',
          maxPrice: '900000',
          auctionType: 'english',
        })
      ).rejects.toThrow('maxPrice must equal reward for auction mode');
    });

    it('throws when dutch auction is missing auctionFloorPrice', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      await expect(
        caller.create({
          ...baseTaskInput,
          mode: 'auction',
          maxPrice: '1000000',
          auctionType: 'dutch',
        })
      ).rejects.toThrow('auctionFloorPrice is required for dutch auction type');
    });

    it('throws when reverse_dutch auction is missing auctionStartPrice', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      await expect(
        caller.create({
          ...baseTaskInput,
          mode: 'auction',
          maxPrice: '1000000',
          auctionType: 'reverse_dutch',
        })
      ).rejects.toThrow('auctionStartPrice is required for reverse_dutch auction type');
    });

    it('creates dutch auction with all required fields', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.create({
        ...baseTaskInput,
        mode: 'auction',
        maxPrice: '1000000',
        auctionType: 'dutch',
        auctionFloorPrice: '500000',
      });
      expect(result.success).toBe(true);
    });

    it('creates reverse_dutch auction with all required fields', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.create({
        ...baseTaskInput,
        mode: 'auction',
        maxPrice: '1000000',
        auctionType: 'reverse_dutch',
        auctionStartPrice: '200000',
      });
      expect(result.success).toBe(true);
    });

    it('creates english auction with only maxPrice and auctionType', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.create({
        ...baseTaskInput,
        mode: 'auction',
        maxPrice: '1000000',
        auctionType: 'english',
      });
      expect(result.success).toBe(true);
    });

    it('creates reverse_english auction with only maxPrice and auctionType', async () => {
      const ctx = createTaskCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.create({
        ...baseTaskInput,
        mode: 'auction',
        maxPrice: '1000000',
        auctionType: 'reverse_english',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('list', () => {
    it('returns tasks list with hasMore=false when results fit within limit', async () => {
      const ctx = createMockCtx();
      // First select returns the main task list (orderBy/limit applied on same chain)
      ctx.db.select
        .mockReturnValueOnce(makeChain([mockTaskRow]))
        // submission count for task
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        // pitch count for task
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.list({ limit: 20 });

      expect(result.tasks).toHaveLength(1);
      expect(result.hasMore).toBe(false);
      // Regression: list() must return the stored visibility, not silently drop it.
      expect(result.tasks[0]!.taskVisibility).toBe('unlisted');
    });

    it('returns hasMore=true when results exceed limit', async () => {
      const ctx = createMockCtx();
      // Return limit+1 rows so hasMore is triggered (limit=1, return 2 rows)
      const rows = [mockTaskRow, { ...mockTaskRow, id: '0xdef' }];
      ctx.db.select
        .mockReturnValueOnce(makeChain(rows))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.list({ limit: 1 });

      expect(result.tasks).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe(mockTaskRow.createdAt.toISOString());
    });

    // Regression: a GET query string only ever delivers a repeated key as an
    // array -- a single `?tags=creative` arrives as the plain string
    // 'creative', not ['creative']. Both CLI and web send tags as one
    // comma-separated value, never a repeated key, so this must parse.
    it('accepts a single tags value as a bare string (as a GET query string delivers it)', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([mockTaskRow]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.list({ limit: 20, tags: 'creative' as unknown as string[] });

      expect(result.tasks).toHaveLength(1);
    });

    it('accepts a comma-separated tags value and splits/trims it', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([mockTaskRow]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.list({
        limit: 20,
        tags: 'creative, dev ,ai' as unknown as string[],
      });

      expect(result.tasks).toHaveLength(1);
    });
  });

  describe('list filters', () => {
    const dialect = new PgDialect();
    const WORKER = '0xWorker000000000000000000000000000000001';
    const REQUESTER = '0xRequester0000000000000000000000000000001';

    // Captures the SQL condition passed to the main list query's .where() so we
    // can assert the filter produces exact-match address conditions.
    function captureListWhere(
      input: Parameters<ReturnType<typeof tasksRouter.createCaller>['list']>[0]
    ) {
      const mainChain = makeChain([mockTaskRow]);
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(mainChain)
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      return caller.list(input).then(() => {
        const whereArg = mainChain.where.mock.calls[0][0];
        return dialect.sqlToQuery(whereArg);
      });
    }

    // Default (unset) status resolves to 'ALL', which -- like 'open' -- excludes
    // pre-Rev007 legacy tasks via a leading createdAt >= cutoff condition (see
    // REV007_LISTING_CUTOFF in tasks.router.ts). The shared taskDiscoverable filter
    // is pushed before that cutoff condition, so every filter combination below
    // carries 'unlisted' and 'private' (bound via Drizzle's `notInArray()`) as its
    // first two parameters, followed by the cutoff ISO timestamp.
    const REV007_CUTOFF_ISO = '2026-06-30T22:15:06.000Z';

    it('filters by worker matching assignment or award membership', async () => {
      const query = await captureListWhere({ worker: WORKER });

      expect(query.sql).toContain('lower("tasks"."claimed_by")');
      expect(query.sql).toContain('from "task_awards"');
      expect(query.sql).toContain('lower("task_awards"."worker_address")');
      expect(query.params).toEqual([
        'unlisted',
        'private',
        REV007_CUTOFF_ISO,
        WORKER.toLowerCase(),
        WORKER.toLowerCase(),
      ]);
    });

    it('filters by requester with an exact address match', async () => {
      const query = await captureListWhere({ requester: REQUESTER });

      expect(query.sql).toContain('"tasks"."requester" = ');
      expect(query.params).toEqual([
        'unlisted',
        'private',
        REV007_CUTOFF_ISO,
        REQUESTER.toLowerCase(),
      ]);
    });

    it('combines requester and worker filters', async () => {
      const query = await captureListWhere({ requester: REQUESTER, worker: WORKER });

      expect(query.sql).toContain('"tasks"."requester" = ');
      expect(query.sql).toContain('lower("tasks"."claimed_by")');
      expect(query.sql).toContain('from "task_awards"');
      expect(query.params).toEqual([
        'unlisted',
        'private',
        REV007_CUTOFF_ISO,
        REQUESTER.toLowerCase(),
        WORKER.toLowerCase(),
        WORKER.toLowerCase(),
      ]);
    });

    it('filters by exact Task Drop membership and composes with status', async () => {
      const query = await captureListWhere({ status: 'completed', taskDropId: DROP_ID });

      expect(query.sql).toContain('"tasks"."task_drop_id" = ');
      expect(query.params).toEqual(['unlisted', 'private', 'completed', DROP_ID]);
    });

    it('filters by a single tags value delivered as a bare string, matching arrayOverlaps', async () => {
      const query = await captureListWhere({ tags: 'creative' as unknown as string[] });

      expect(query.sql).toContain('&&');
      expect(query.params).toEqual(['unlisted', 'private', REV007_CUTOFF_ISO, '{"creative"}']);
    });

    it('filters by a comma-separated tags value, splitting into an array before arrayOverlaps', async () => {
      const query = await captureListWhere({ tags: 'creative,dev' as unknown as string[] });

      expect(query.sql).toContain('&&');
      expect(query.params).toEqual([
        'unlisted',
        'private',
        REV007_CUTOFF_ISO,
        '{"creative","dev"}',
      ]);
    });

    it('always excludes unlisted tasks from discovery listings (ADR-0014)', async () => {
      const query = await captureListWhere({});

      expect(query.sql).toContain('"tasks"."task_visibility" not in');
      expect(query.params).toContain('unlisted');
      expect(query.params).toContain('private');
    });

    // A submission-window status (open/claimed/worker_selected) whose deadline has
    // passed is real and common -- see computeSubmissionWindowOpen in lib/task.ts --
    // but a plain status filter should not surface it, the same way status=open
    // already excludes it (#166). These three tests lock that guard in across every
    // submission-window status, not just 'open'.
    function expiryParamNearNow(query: { params: unknown[] }) {
      const raw = query.params.at(-1);
      const ms = raw instanceof Date ? raw.getTime() : new Date(raw as string).getTime();
      return Math.abs(Date.now() - ms);
    }

    it('excludes tasks whose deadline has passed when filtering by status=open', async () => {
      const query = await captureListWhere({ status: 'open' });

      expect(query.sql).toContain('"tasks"."expiry_time" > ');
      expect(query.params.slice(0, 4)).toEqual(['unlisted', 'private', 'open', REV007_CUTOFF_ISO]);
      expect(query.params).toHaveLength(5);
      expect(expiryParamNearNow(query)).toBeLessThan(5_000);
    });

    it('applies the same expiry-exclusion guard to status=claimed (claim/auction submission window)', async () => {
      const query = await captureListWhere({ status: 'claimed' });

      expect(query.sql).toContain('"tasks"."status" = ');
      expect(query.sql).toContain('"tasks"."expiry_time" > ');
      // Non-open statuses stay outside the REV007 cutoff guard (unchanged, historical
      // records must stay queryable), so this is exactly 4 params, not 5.
      expect(query.params).toHaveLength(4);
      expect(query.params.slice(0, 3)).toEqual(['unlisted', 'private', 'claimed']);
      expect(expiryParamNearNow(query)).toBeLessThan(5_000);
    });

    it('applies the same expiry-exclusion guard to status=worker_selected (pitch submission window)', async () => {
      const query = await captureListWhere({ status: 'worker_selected' });

      expect(query.sql).toContain('"tasks"."status" = ');
      expect(query.sql).toContain('"tasks"."expiry_time" > ');
      expect(query.params).toHaveLength(4);
      expect(query.params.slice(0, 3)).toEqual(['unlisted', 'private', 'worker_selected']);
      expect(expiryParamNearNow(query)).toBeLessThan(5_000);
    });

    it('does not apply the expiry guard to a terminal status filter', async () => {
      const query = await captureListWhere({ status: 'completed' });

      expect(query.sql).not.toContain('"tasks"."expiry_time" > ');
      expect(query.params).toEqual(['unlisted', 'private', 'completed']);
    });

    // `phase` (ADR-0024) is a derived filter, not a stored column -- these lock in that
    // it translates to the same status/expiry SQL condition computeTaskPhase applies
    // in memory (lib/task.ts), for every one of its four values.
    it('filters by phase=in_review as a status IN (review, appealing, disputed) condition', async () => {
      const query = await captureListWhere({ phase: 'in_review' });

      expect(query.sql).toContain('"tasks"."status" in (');
      expect(query.params).toEqual([
        'unlisted',
        'private',
        REV007_CUTOFF_ISO,
        'review',
        'appealing',
        'disputed',
      ]);
    });

    it('filters by phase=resolved as a status IN (completed, cancelled, expired) condition', async () => {
      const query = await captureListWhere({ phase: 'resolved' });

      expect(query.sql).toContain('"tasks"."status" in (');
      expect(query.params).toEqual([
        'unlisted',
        'private',
        REV007_CUTOFF_ISO,
        'completed',
        'cancelled',
        'expired',
      ]);
    });

    it('filters by phase=awaiting_settlement as submission-window statuses past their deadline', async () => {
      const query = await captureListWhere({ phase: 'awaiting_settlement' });

      expect(query.sql).toContain('"tasks"."status" in (');
      expect(query.sql).toContain('"tasks"."expiry_time" <= ');
      expect(query.params.slice(0, 6)).toEqual([
        'unlisted',
        'private',
        REV007_CUTOFF_ISO,
        'open',
        'claimed',
        'worker_selected',
      ]);
      const expiryMs = new Date(query.params[6] as string).getTime();
      expect(Math.abs(Date.now() - expiryMs)).toBeLessThan(5_000);
    });

    it('filters by phase=active as submission-window statuses before their deadline, or pending_approval', async () => {
      const query = await captureListWhere({ phase: 'active' });

      expect(query.sql).toContain('"tasks"."status" in (');
      expect(query.sql).toContain('"tasks"."expiry_time" > ');
      expect(query.params).toEqual([
        'unlisted',
        'private',
        REV007_CUTOFF_ISO,
        'open',
        'claimed',
        'worker_selected',
        expect.any(String),
        'pending_approval',
      ]);
    });
  });
});
