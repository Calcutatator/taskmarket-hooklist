import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIntentCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractSubmitProof: vi.fn().mockResolvedValue('0xprooftx'),
  contractSubmitWork: vi.fn().mockResolvedValue('0xsubmissiontx'),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    BACKEND_URL: 'http://localhost:3000',
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: '0xD17485087c2d31bf5562ACf0C5295111982A1CBF',
    DEFAULT_PLATFORM_FEE_BPS: 500,
    ERC8004_IDENTITY_REGISTRY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  }),
}));

import { proofsRouter } from '../../../src/routers/proofs.router';
import { proofs, submissions } from '../../../src/db/schema';
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
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not benchmark', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Not a Benchmark task');
    });

    it('throws when task is not open', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'pending_approval' })]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow(
        'Task not open for proof submission'
      );
    });

    it('anchors proof and deliverable, then returns both record IDs', async () => {
      const ctx = createIntentCtx(WORKER); // X402 payer = worker
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(typeof result.proofId).toBe('string');
      expect(typeof result.submissionId).toBe('string');
      expect(contractSubmitProof).toHaveBeenCalledOnce();
      // The deliverable commitment is a second contract call, so it is a second intent of its
      // own, recorded and dispatched by the proof's completion handler. ADR-0047 withdrew the
      // chaining subsystem, so this is not a chained follow-on; the decision that governs a
      // completion handler recording follow-on work is ADR-0052 point 8, which names "a
      // deliverable anchor after a proof" directly and gives it a key derived from the parent
      // rather than a random one, so an at-least-once completion rerun collapses onto the same
      // follow-on instead of making a second chain call.
      expect(contractSubmitWork).toHaveBeenCalledOnce();
      expect(ctx.insertChain(proofs).values).toHaveBeenCalledOnce();
      expect(ctx.insertChain(submissions).values).toHaveBeenCalledOnce();
      expect(ctx.intents.map((intent) => intent.operation)).toEqual([
        'proofs.submit',
        'proofs.anchorDeliverable',
      ]);
    });

    it('throws BAD_REQUEST when X402 payer is missing', async () => {
      const ctx = createIntentCtx(); // no payer
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Payment required');
    });

    it('throws FORBIDDEN when X402 payer does not match workerAddress', async () => {
      const OTHER = '0x9999999999999999999999999999999999999999';
      const ctx = createIntentCtx(OTHER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = proofsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Payer must match workerAddress');
    });

    // Verifies: ADR-0045
    it('still records the proof when the deliverable commitment does not land', async () => {
      // The proof is anchored on chain; the commitment is a separate intent whose own row
      // records where it stopped, so a failure there must not undo or hide the proof.
      vi.mocked(contractSubmitWork).mockRejectedValueOnce(new Error('relay failed'));
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const result = await proofsRouter.createCaller(ctx).submit(submitInput);

      expect(result.success).toBe(true);
      expect(ctx.insertChain(proofs).values).toHaveBeenCalledOnce();
      expect(ctx.insertChain(submissions).values).not.toHaveBeenCalled();
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
      const ctx = createIntentCtx(OUTSIDER);
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
      const ctx = createIntentCtx(OUTSIDER, undefined, { taskId: TASK_ID });
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
      const ctx = createIntentCtx(ALLOWED);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ taskVisibility: 'private' })]))
        .mockReturnValueOnce(makeChain([{ viewerAddress: ALLOWED }])) // allowlisted
        .mockReturnValueOnce(makeChain([])); // no awards

      const caller = proofsRouter.createCaller(ctx);
      const result = await caller.submit(privateSubmitInput(ALLOWED));
      expect(result.success).toBe(true);
    });

    it('allows an awarded worker to submit a proof on a private task', async () => {
      const ctx = createIntentCtx(ALLOWED);
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
      const ctx = createIntentCtx(REQUESTER_ADDR);
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
      const ctx = createIntentCtx();
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
      const ctx = createIntentCtx();
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
