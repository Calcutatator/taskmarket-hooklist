import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createMockCtx, makeChain } from '../helpers';

// Mock contract service before importing router
vi.mock('../../../src/services/contract', () => ({
  contractCreateTask: vi.fn().mockResolvedValue('0xescrowhash'),
  contractUpdateTask: vi.fn().mockResolvedValue('0xupdatehash'),
  contractCancelTask: vi.fn().mockResolvedValue('0xcancelhash'),
  contractGetTaskHooks: vi.fn().mockResolvedValue([]),
  contractGetDreamsPerUsdc: vi.fn().mockResolvedValue(0n),
  contractGetDreamsWorkerSplitBps: vi.fn().mockResolvedValue(0),
  contractGetDreamsBonusBps: vi.fn().mockResolvedValue(0),
  precomputeTaskId: vi.fn().mockResolvedValue('0x' + 'a'.repeat(64)),
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

// Mock config so no real env vars are needed
vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
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
  }),
}));

import { tasksRouter } from '../../../src/routers/tasks.router';
import {
  contractCreateTask,
  contractUpdateTask,
  contractCancelTask,
  contractGetTaskHooks,
  contractGetDreamsPerUsdc,
  contractGetDreamsWorkerSplitBps,
  contractGetDreamsBonusBps,
} from '../../../src/services/contract';
import { getServerConfig } from '../../../src/config/env';
import { notifyNewTask } from '../../../src/services/task-notifications';

// Allow microtask-queued fire-and-forget work (notifyNewTask) to settle.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const PAYER = '0xRequester0000000000000000000000000000001';

const baseTaskInput = {
  description: 'Test task',
  reward: '1000000',
  duration: 7,
  tags: ['test'],
  mode: 'bounty' as const,
  stakeRequired: false,
  stakeBps: 0,
};

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
};

describe('tasks router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('throws when payer is missing', async () => {
      const ctx = createMockCtx(); // no payer
      const caller = tasksRouter.createCaller(ctx);
      await expect(caller.create(baseTaskInput)).rejects.toThrow('Payment required: missing payer');
    });

    it('creates task and returns taskId on valid input', async () => {
      const ctx = createMockCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create(baseTaskInput);

      expect(contractCreateTask).toHaveBeenCalledOnce();
      expect(ctx.db.insert).toHaveBeenCalledOnce();
      expect(result.success).toBe(true);
      expect(typeof result.taskId).toBe('string');
      expect(result.taskId.startsWith('0x')).toBe(true);
    });

    it('passes mode to contractCreateTask', async () => {
      const ctx = createMockCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      await caller.create({ ...baseTaskInput, mode: 'claim' });

      const [, , , mode] = vi.mocked(contractCreateTask).mock.calls[0];
      expect(mode).toBe('0x00000002'); // MODE_MAP.claim
    });

    it('fires the targeted new-task notification exactly once on success', async () => {
      const ctx = createMockCtx(PAYER);
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
    });

    it('passes task tags through to the notifier for skill targeting', async () => {
      const ctx = createMockCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      await caller.create({ ...baseTaskInput, tags: ['design', 'logo'] });

      const [arg] = vi.mocked(notifyNewTask).mock.calls[0];
      expect(arg.tags).toEqual(['design', 'logo']);
    });

    it('still returns success when the notification send fails (fire-and-forget)', async () => {
      vi.mocked(notifyNewTask).mockRejectedValueOnce(new Error('mailer down'));
      const ctx = createMockCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);

      const result = await caller.create(baseTaskInput);

      expect(result.success).toBe(true);
      expect(typeof result.taskId).toBe('string');
      // The fire-and-forget rejection is swallowed by the router's .catch handler.
      await flushAsync();
      expect(notifyNewTask).toHaveBeenCalledOnce();
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
    });

    it('emits forfeit pendingAction for a claimed claim-mode task', async () => {
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
      expect(actions.some((a) => a.action === 'submit' && a.role === 'worker')).toBe(true);
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
      const activeRow = { ...mockTaskRow, status: 'open', expiryTime: new Date(Date.now() + 72 * 3600 * 1000) };
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
      const expiredRow = { ...mockTaskRow, status: 'open', expiryTime: new Date(Date.now() - 3600 * 1000) };
      ctx.db.select
        .mockReturnValueOnce(makeChain([expiredRow]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.submissionWindowOpen).toBe(false);
    });

    it('is false for a claimed task', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([{ ...mockTaskRow, status: 'claimed', claimedBy: '0xworker' }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result!.submissionWindowOpen).toBe(false);
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
      const ctx = createMockCtx(PAYER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([openBountyRow]))
        .mockReturnValueOnce(makeChain([{ ...openBountyRow, reward: '5000000' }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]))
        .mockReturnValueOnce(makeChain([{ count: 0 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.update({ taskId: '0xabc', reward: '5000000' });

      expect(contractUpdateTask).toHaveBeenCalledOnce();
      expect(result!.reward).toBe('5000000');
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
      expect(actions.some((a) => a.action === 'cancel' && a.role === 'requester')).toBe(true);
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

      expect(result!.pendingActions.some((a) => a.action === 'accept' && a.role === 'requester')).toBe(true);
    });

    it('returns no actions for an expired open bounty with no submissions', async () => {
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

      expect(result!.pendingActions).toHaveLength(1);
      expect(result!.pendingActions[0].action).toBe('refund_expired');
      expect(result!.pendingActions[0].role).toBe('requester');
    });
  });

  describe('cancel', () => {
    it('allows cancelling an open bounty with submissions', async () => {
      const ctx = createMockCtx(PAYER);
      ctx.db.select.mockReturnValueOnce(makeChain([{ ...mockTaskRow, status: 'open' }]));

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

  describe('create auction validation', () => {
    it('throws when auction mode is missing maxPrice', async () => {
      const ctx = createMockCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      await expect(
        caller.create({ ...baseTaskInput, mode: 'auction', auctionType: 'english' })
      ).rejects.toThrow('maxPrice is required for auction mode');
    });

    it('throws when auction mode is missing auctionType', async () => {
      const ctx = createMockCtx(PAYER);
      const caller = tasksRouter.createCaller(ctx);
      await expect(
        caller.create({ ...baseTaskInput, mode: 'auction', maxPrice: '1000000' })
      ).rejects.toThrow('auctionType is required for auction mode');
    });

    it('throws when dutch auction is missing auctionFloorPrice', async () => {
      const ctx = createMockCtx(PAYER);
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
      const ctx = createMockCtx(PAYER);
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
      const ctx = createMockCtx(PAYER);
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
      const ctx = createMockCtx(PAYER);
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
      const ctx = createMockCtx(PAYER);
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
      const ctx = createMockCtx(PAYER);
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
  });

  describe('list filters', () => {
    const dialect = new PgDialect();
    const WORKER = '0xWorker000000000000000000000000000000001';
    const REQUESTER = '0xRequester0000000000000000000000000000001';

    // Captures the SQL condition passed to the main list query's .where() so we
    // can assert the filter produces exact-match address conditions.
    function captureListWhere(input: Parameters<ReturnType<typeof tasksRouter.createCaller>['list']>[0]) {
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

    it('filters by worker matching worker OR claimedBy with exact addresses', async () => {
      const query = await captureListWhere({ worker: WORKER });

      expect(query.sql).toContain('"tasks"."worker" = ');
      expect(query.sql).toContain('"tasks"."claimed_by" = ');
      expect(query.sql).toMatch(/"tasks"."worker" = \$\d+ or "tasks"."claimed_by" = \$\d+/);
      expect(query.params).toEqual([WORKER.toLowerCase(), WORKER.toLowerCase()]);
    });

    it('filters by requester with an exact address match', async () => {
      const query = await captureListWhere({ requester: REQUESTER });

      expect(query.sql).toContain('"tasks"."requester" = ');
      expect(query.params).toEqual([REQUESTER.toLowerCase()]);
    });

    it('combines requester and worker filters', async () => {
      const query = await captureListWhere({ requester: REQUESTER, worker: WORKER });

      expect(query.sql).toContain('"tasks"."requester" = ');
      expect(query.sql).toContain('"tasks"."worker" = ');
      expect(query.sql).toContain('"tasks"."claimed_by" = ');
      expect(query.params).toEqual([REQUESTER.toLowerCase(), WORKER.toLowerCase(), WORKER.toLowerCase()]);
    });
  });
});
