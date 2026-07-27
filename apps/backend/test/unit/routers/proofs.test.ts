import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractSubmitProof: vi.fn().mockResolvedValue('0xprooftx'),
  contractSubmitWork: vi.fn().mockResolvedValue('0xsubmissiontx'),
}));

import { proofsRouter } from '../../../src/routers/proofs.router';
import { contractSubmitProof, contractSubmitWork } from '../../../src/services/contract';

const WORKER = '0x0000000000000000000000000000000000000001';
const TASK_ID = '0x7461736b00000000000000000000000000000000000000000000000000000001';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: '0xRequester',
    requesterPubkey: '0xRequester',
    description: 'Benchmark task',
    reward: '1000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    mode: 'benchmark',
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

function makeProof() {
  return {
    id: 'proof-id',
    taskId: TASK_ID,
    workerAddress: WORKER,
    proofData: 'proof-data-hash',
    proofType: 'url',
    metricValue: null,
    signature: '0xsig',
    status: 'pending',
    proofHash: `0x${'ab'.repeat(32)}`,
    submitTxHash: '0xprooftx',
    submittedAt: new Date('2026-07-11T00:00:00.000Z'),
  };
}

describe('proofs router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submit', () => {
    const submitInput = {
      taskId: TASK_ID,
      workerAddress: WORKER,
      proofData: 'proof-data-hash',
      proofType: 'url' as const,
      signature: '0xsig',
    };

    it('throws when task not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not benchmark', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Not a Benchmark task');
    });

    it('throws when task is not open', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'pending_approval' })]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow(
        'Task not open for proof submission'
      );
    });

    it('anchors proof and deliverable, then returns both record IDs', async () => {
      const ctx = createMockCtx(WORKER); // X402 payer = worker
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(typeof result.proofId).toBe('string');
      expect(typeof result.submissionId).toBe('string');
      expect(contractSubmitProof).toHaveBeenCalledOnce();
      expect(contractSubmitWork).toHaveBeenCalledOnce();
      expect(ctx.db.transaction).toHaveBeenCalledOnce();
      expect(ctx.db.insert).toHaveBeenCalledTimes(2);
    });

    it('throws BAD_REQUEST when X402 payer is missing', async () => {
      const ctx = createMockCtx(); // no payer
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Payment required');
    });

    it('throws FORBIDDEN when X402 payer does not match workerAddress', async () => {
      const OTHER = '0x9999999999999999999999999999999999999999';
      const ctx = createMockCtx(OTHER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Payer must match workerAddress');
    });

    it('returns the proof transaction hash when deliverable commitment fails', async () => {
      vi.mocked(contractSubmitWork).mockRejectedValueOnce(new Error('relay failed'));
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      await expect(proofsRouter.createCaller(ctx).submit(submitInput)).rejects.toThrow(
        'Proof anchored onchain (0xprooftx) but deliverable commitment failed'
      );
    });

    it('returns both transaction hashes when database sync fails', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));
      ctx.db.transaction.mockRejectedValueOnce(new Error('database unavailable'));

      await expect(proofsRouter.createCaller(ctx).submit(submitInput)).rejects.toThrow(
        'Proof and deliverable anchored onchain (0xprooftx, 0xsubmissiontx)'
      );
    });
  });

  describe('submit - private task standing (F4)', () => {
    const OUTSIDER = '0x9999999999999999999999999999999999999999';
    const ALLOWED = '0x0000000000000000000000000000000000000002';

    function privateSubmitInput(workerAddress: string) {
      return {
        taskId: TASK_ID,
        workerAddress,
        proofData: 'proof-data-hash',
        proofType: 'url' as const,
        signature: '0xsig',
      };
    }

    it('throws FORBIDDEN when an outsider with zero standing submits a proof', async () => {
      const ctx = createMockCtx(OUTSIDER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([])) // allowlist empty
        .mockReturnValueOnce(makeChain([])); // no awards

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(privateSubmitInput(OUTSIDER))).rejects.toThrow(
        'Not authorized to submit a proof on this private task'
      );
    });

    it('throws FORBIDDEN for an outsider even when holding a taskAccessGrant for this task', async () => {
      const ctx = createMockCtx(OUTSIDER, undefined, { taskId: TASK_ID });
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([])) // allowlist empty
        .mockReturnValueOnce(makeChain([])); // no awards

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(privateSubmitInput(OUTSIDER))).rejects.toThrow(
        'Not authorized to submit a proof on this private task'
      );
    });

    it('allows an allowlisted wallet to submit a proof on a private task', async () => {
      const ctx = createMockCtx(ALLOWED);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([{ viewerAddress: ALLOWED }])) // allowlisted
        .mockReturnValueOnce(makeChain([])); // no awards

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.submit(privateSubmitInput(ALLOWED));
      expect(result.success).toBe(true);
    });

    it('allows an awarded worker to submit a proof on a private task', async () => {
      const ctx = createMockCtx(ALLOWED);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([])) // allowlist empty
        .mockReturnValueOnce(makeChain([{ workerAddress: ALLOWED }])); // awarded

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.submit(privateSubmitInput(ALLOWED));
      expect(result.success).toBe(true);
    });

    it('allows the task requester to submit a proof on their own private task', async () => {
      // Unlike the plain-string '0xRequester' used elsewhere in this file, this
      // endpoint hashes workerAddress as a viem `address` ABI param (buildProofHash),
      // so the requester override here must be a real 20-byte hex address.
      const REQUESTER_ADDR = '0x0000000000000000000000000000000000000003';
      const ctx = createMockCtx(REQUESTER_ADDR);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ taskVisibility: 'private', requester: REQUESTER_ADDR })])
      );
      // requester short-circuits before any allowlist/award query

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.submit(privateSubmitInput(REQUESTER_ADDR));
      expect(result.success).toBe(true);
    });
  });

  describe('listByTask', () => {
    it('returns the acceptable submission ID for a current proof commitment', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        // Phase 3 (ADR-0030): resolveTaskViewability's task lookup runs first.
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([makeProof()]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ id: 'submission-id' }]));

      const result = await proofsRouter.createCaller(ctx).listByTask({ taskId: TASK_ID });

      expect(result[0].submissionId).toBe('submission-id');
    });

    it('returns null submissionId for a legacy proof', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        // Phase 3 (ADR-0030): resolveTaskViewability's task lookup runs first.
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([makeProof()]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await proofsRouter.createCaller(ctx).listByTask({ taskId: TASK_ID });

      expect(result[0].submissionId).toBeNull();
    });
  });
});
