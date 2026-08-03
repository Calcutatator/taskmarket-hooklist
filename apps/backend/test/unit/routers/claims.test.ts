import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIntentCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractClaimTask: vi.fn().mockResolvedValue('0xstaketx'),
  contractForfeitAndReopen: vi.fn().mockResolvedValue('0xforfeittx'),
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

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    recoverMessageAddress: vi.fn(),
  };
});

import { claimsRouter } from '../../../src/routers/claims.router';
import { contractClaimTask, contractForfeitAndReopen } from '../../../src/services/contract';
import { claims as claimsTable, tasks as tasksTable } from '../../../src/db/schema';
import { recoverMessageAddress } from 'viem';

const WORKER = '0xWorker0000000000000000000000000000000001';
const TASK_ID = '0xtask0000000000000000000000000000000001';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: '0xRequester',
    requesterPubkey: '0xRequester',
    description: 'Claim task',
    reward: '1000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    mode: 'claim',
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

describe('claims router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('claim', () => {
    const claimInput = { taskId: TASK_ID, workerAddress: WORKER, signature: '0xsig' };

    it('throws when task not found', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(claimInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not claim', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(claimInput)).rejects.toThrow('Not a Claim task');
    });

    it('throws when task is already claimed (status != open)', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'claimed' })]));

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(claimInput)).rejects.toThrow('Task not available for claiming');
    });

    it('claims task on happy path', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.claim(claimInput);

      expect(result.success).toBe(true);
      expect(typeof result.claimId).toBe('string');
      expect(contractClaimTask).toHaveBeenCalledOnce();
      expect(contractClaimTask).toHaveBeenCalledWith(TASK_ID, WORKER, 0n, undefined);
      // Verifies: ADR-0045 -- the same rows as before, now written by the completion handler.
      expect(ctx.insertChain(claimsTable).values).toHaveBeenCalledWith(
        expect.objectContaining({
          id: result.claimId,
          stakeAmount: '0',
          stakeTxHash: '0xstaketx',
          status: 'active',
          taskId: TASK_ID,
          workerAddress: WORKER,
        })
      );
      expect(ctx.updateChain(tasksTable).set).toHaveBeenCalledWith(
        expect.objectContaining({ claimedBy: WORKER, status: 'claimed' })
      );
    });

    // Verifies: ADR-0045
    it('records the intent before the chain call, and completes it after', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const result = await claimsRouter.createCaller(ctx).claim(claimInput);

      expect(ctx.intents).toHaveLength(1);
      const intent = ctx.intents[0]!;
      expect(intent.operation).toBe('claims.claim');
      // Free: no payment reference at all, so settlement can never try to refund it.
      expect(intent.paymentTxHash).toBeNull();
      expect(intent.paymentAmount).toBeNull();
      // The claim id the caller was given is the one persisted, so a completion run later
      // from the reconciler produces the same row rather than a second one.
      expect((intent.payload as { claimId: string }).claimId).toBe(result.claimId);
      expect(intent.status).toBe('completed');
      expect(intent.txHash).toBe('0xstaketx');
    });

    // Verifies: ADR-0045
    it('leaves the intent unbroadcast and writes nothing when the chain call fails', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(WORKER as `0x${string}`);
      vi.mocked(contractClaimTask).mockRejectedValueOnce(new Error('TaskNotOpen'));
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await expect(claimsRouter.createCaller(ctx).claim(claimInput)).rejects.toThrow('TaskNotOpen');

      // Still 'recorded': only confirmed on-chain evidence writes a terminal state, and no
      // claim row exists for a claim the chain rejected.
      expect(ctx.intents[0]!.status).toBe('recorded');
      expect(ctx.insertChain(claimsTable).values).not.toHaveBeenCalled();
    });

    it('throws BAD_REQUEST when signature is invalid', async () => {
      vi.mocked(recoverMessageAddress).mockRejectedValueOnce(new Error('bad sig'));
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(claimInput)).rejects.toThrow('Invalid signature');
    });

    it('throws UNAUTHORIZED when signature is from different address', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(
        '0x0000000000000000000000000000000000000001' as `0x${string}`
      );
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(claimInput)).rejects.toThrow(
        'Signature does not match worker address'
      );
    });
  });

  describe('claim - private task standing (F6)', () => {
    const OUTSIDER = '0x9999999999999999999999999999999999999999';
    const ALLOWED = '0x0000000000000000000000000000000000000002';

    function privateClaimInput(workerAddress: string) {
      return { taskId: TASK_ID, workerAddress, signature: '0xsig' };
    }

    it('throws FORBIDDEN when an outsider with zero standing tries to claim a private task', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(OUTSIDER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([])) // allowlist empty
        .mockReturnValueOnce(makeChain([])); // no awards

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(privateClaimInput(OUTSIDER))).rejects.toThrow(
        'Not authorized to claim this private task'
      );
    });

    it('throws FORBIDDEN for an outsider even when holding a taskAccessGrant for this task', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(OUTSIDER as `0x${string}`);
      const ctx = createIntentCtx(undefined, undefined, { taskId: TASK_ID });
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([])) // allowlist empty
        .mockReturnValueOnce(makeChain([])); // no awards

      const caller = claimsRouter.createCaller(ctx);
      await expect(caller.claim(privateClaimInput(OUTSIDER))).rejects.toThrow(
        'Not authorized to claim this private task'
      );
    });

    it('allows an allowlisted wallet to claim a private task', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(ALLOWED as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([{ viewerAddress: ALLOWED }])) // allowlisted
        .mockReturnValueOnce(makeChain([])); // no awards

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.claim(privateClaimInput(ALLOWED));
      expect(result.success).toBe(true);
    });

    it('allows an awarded worker to claim a private task', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(ALLOWED as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([])) // allowlist empty
        .mockReturnValueOnce(makeChain([{ workerAddress: ALLOWED }])); // awarded

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.claim(privateClaimInput(ALLOWED));
      expect(result.success).toBe(true);
    });

    it('allows the task requester to claim their own private task', async () => {
      const REQUESTER_ADDR = '0xRequester';
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(REQUESTER_ADDR as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ taskVisibility: 'private', requester: REQUESTER_ADDR })])
      );
      // requester short-circuits before any allowlist/award query

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.claim(privateClaimInput(REQUESTER_ADDR));
      expect(result.success).toBe(true);
    });
  });

  describe('forfeit', () => {
    const REQUESTER = '0xRequester';
    const forfeitInput = {
      taskId: TASK_ID,
      requesterAddress: REQUESTER,
      signature: '0xsig',
    };

    // Verifies: ADR-0045
    it('reopens the task and retires the claim through a completed intent', async () => {
      vi.mocked(recoverMessageAddress).mockResolvedValueOnce(REQUESTER as `0x${string}`);
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'claimed' })]));

      const result = await claimsRouter.createCaller(ctx).forfeit(forfeitInput);

      expect(result.txHash).toBe('0xforfeittx');
      expect(contractForfeitAndReopen).toHaveBeenCalledWith(TASK_ID, REQUESTER, undefined);
      expect(ctx.updateChain(claimsTable).set).toHaveBeenCalledWith({ status: 'forfeited' });
      expect(ctx.updateChain(tasksTable).set).toHaveBeenCalledWith({
        claimedAt: null,
        claimedBy: null,
        status: 'open',
      });

      const intent = ctx.intents[0]!;
      expect(intent.operation).toBe('claims.forfeit');
      expect(intent.paymentTxHash).toBeNull();
      expect(intent.status).toBe('completed');
    });

    it('rejects a caller who is not the requester', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'claimed' })]));

      await expect(
        claimsRouter.createCaller(ctx).forfeit({ ...forfeitInput, requesterAddress: WORKER })
      ).rejects.toThrow('Only the task requester can forfeit');
      expect(ctx.intents).toHaveLength(0);
    });
  });

  describe('getByTask', () => {
    it('returns null when no claim exists', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.getByTask({ taskId: TASK_ID });

      expect(result).toBeNull();
    });

    it('returns claim when found', async () => {
      const claimRow = {
        id: 'claim-id-1',
        taskId: TASK_ID,
        workerAddress: WORKER,
        stakeAmount: '0',
        stakeTxHash: '0xstaketx',
        claimedAt: new Date(),
        status: 'active',
      };

      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([claimRow]));

      const caller = claimsRouter.createCaller(ctx);
      const result = await caller.getByTask({ taskId: TASK_ID });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('claim-id-1');
      expect(result!.workerAddress).toBe(WORKER);
      expect(result!.status).toBe('active');
    });
  });
});
