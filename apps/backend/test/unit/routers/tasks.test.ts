import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

// Mock contract service before importing router
vi.mock('../../../src/services/contract', () => ({
  contractCreateTask: vi.fn().mockResolvedValue('0xescrowhash'),
  MODE_MAP: { bounty: 0, claim: 1, pitch: 2, benchmark: 3, auction: 4 },
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
import { contractCreateTask } from '../../../src/services/contract';

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

      const [, , , , mode] = (contractCreateTask as any).mock.calls[0];
      expect(mode).toBe(1); // MODE_MAP.claim
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
      // task lookup → submission count → pitch count
      ctx.db.select
        .mockReturnValueOnce(makeChain([mockTaskRow]))
        .mockReturnValueOnce(makeChain([{ count: 3 }]))
        .mockReturnValueOnce(makeChain([{ count: 1 }]));

      const caller = tasksRouter.createCaller(ctx);
      const result = await caller.get({ taskId: '0xabc' });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(mockTaskRow.id);
      expect(result!.submissionCount).toBe(3);
      expect(result!.pitchCount).toBe(1);
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
      expect(result.nextCursor).toBe(mockTaskRow.id);
    });
  });
});
