import { router, publicProcedure, optionalAuthProcedure } from '../trpc';
import { ProofSubmitSchema, ProofResponseSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { proofs, submissions, tasks, agents } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';
import { TRPCError } from '@trpc/server';
import { contractSubmitProof } from '../services/contract';
import { buildProofHash } from '../lib/canonical-hashes';
import { lowerAddressEq } from '../lib/agents';
import { runRelayedIntent } from '../services/relayed-intent-request';
import type { ProofsSubmitIntentPayload } from '../services/intents/proofs-intents';
import { fetchPrivateViewabilityContext, resolveTaskViewability } from '../lib/task-visibility';
import type { Context } from '../context';

/**
 * Phase 3 (ADR-0030) parity fix (F4): `submit` must enforce the same private-task
 * standing check as this router's own `listByTask` reader (resolveTaskViewability),
 * instead of letting any signed/paying worker submit a proof on a
 * `taskVisibility: 'private'` benchmark task. Deliberately narrower than the
 * general-purpose `canView` helper: standing here is requester / task.claimedBy / an
 * awarded worker (task_awards) / an allowlisted wallet (task_allowed_viewers) only -- a
 * bare `taskAccessGrant` (the view-only, password-derived bearer credential from
 * `taskAccess.verifyPassword`) is never sufficient, since that credential exists purely
 * for read/view access and was never meant to authorize a write/participation action
 * like submitting a proof.
 *
 * Must run AFTER the caller's identity is cryptographically resolved (the X402 payer
 * check that payer === input.workerAddress), never before -- checking earlier would
 * let an attacker probe arbitrary candidate addresses and use the
 * FORBIDDEN-vs-payment-error response difference as a private-task membership oracle.
 */
async function assertCanParticipateInPrivateTask(
  db: Context['db'],
  task: { id: string; taskVisibility: string; requester: string; claimedBy: string | null },
  address: string
): Promise<void> {
  if (task.taskVisibility !== 'private') return;

  const normalized = address.toLowerCase();
  if (normalized === task.requester.toLowerCase()) return;
  if (task.claimedBy && normalized === task.claimedBy.toLowerCase()) return;

  const { allowedViewerAddresses, awardedWorkerAddresses } = await fetchPrivateViewabilityContext(
    db,
    task.id
  );
  if (awardedWorkerAddresses.has(normalized) || allowedViewerAddresses.has(normalized)) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Not authorized to submit a proof on this private task',
  });
}

export const proofsRouter = router({
  submit: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/proofs',
        tags: ['Tasks'],
        summary: 'Submit a proof for a race task',
      },
    })
    .input(ProofSubmitSchema)
    .output(z.object({ success: z.boolean(), proofId: z.string(), submissionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new Error('Task not found');
      }

      const task = taskResult[0];

      if (task.mode !== 'benchmark') {
        throw new Error('Not a Benchmark task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open for proof submission');
      }

      if (new Date() > task.expiryTime) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task has expired' });
      }

      // X402 payment guard: same pattern as pitches — middleware sets payer,
      // we enforce payer == workerAddress so a worker can't pay to submit a
      // proof masquerading as someone else.
      const payer: string | undefined = ctx.res.locals.payer;
      if (!payer) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payment required: missing payer' });
      }
      if (payer.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Payer must match workerAddress',
        });
      }

      // F4: gate participation on a private task the same way listByTask gates
      // reads -- must run after the payer check above so the caller's identity is
      // already cryptographically verified before we branch on it.
      await assertCanParticipateInPrivateTask(ctx.db, task, payer);

      // Parse metricValue as uint256. Empty string → 0. Reject non-integer input.
      let metricValueBig: bigint;
      try {
        metricValueBig = input.metricValue ? BigInt(input.metricValue) : 0n;
        if (metricValueBig < 0n) throw new Error('negative');
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'metricValue must be a non-negative integer',
        });
      }

      const proofHash = buildProofHash(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        input.proofData
      );
      const proofTypeBytes32 = keccak256(toBytes(input.proofType));

      const proofId = randomUUID();
      const submissionId = randomUUID();

      // One intent, one contract call (ADR-0047). The deliverable commitment that follows is
      // a second call and gets its own intent, recorded and dispatched by this one's
      // completion handler -- the shape task creation already uses for evaluator assignment.
      await runRelayedIntent({
        db: ctx.db,
        operation: 'proofs.submit',
        payer,
        paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
        payload: {
          contractAddress: task.contractAddress,
          metricValue: input.metricValue || null,
          proofData: input.proofData,
          proofHash,
          proofId,
          proofType: input.proofType,
          signature: input.signature,
          submissionId,
          taskId: input.taskId,
          workerAddress: input.workerAddress,
        } satisfies ProofsSubmitIntentPayload,
        send: () =>
          contractSubmitProof(
            input.taskId as `0x${string}`,
            input.workerAddress as `0x${string}`,
            proofHash,
            proofTypeBytes32,
            metricValueBig,
            task.contractAddress
          ),
      });

      return { success: true, proofId, submissionId };
    }),

  listByTask: optionalAuthProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/proofs',
        tags: ['Tasks'],
        summary: 'List proofs for a benchmark task',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(z.array(ProofResponseSchema))
    .query(async ({ input, ctx }) => {
      // Phase 3 (ADR-0030): a private task the caller can't view returns no proofs,
      // matching this endpoint's pre-existing "unknown taskId returns []" behavior.
      const { viewable } = await resolveTaskViewability(
        ctx.db,
        input.taskId,
        ctx.caller,
        ctx.taskAccessGrant
      );
      if (!viewable) return [];

      const results = await ctx.db.select().from(proofs).where(eq(proofs.taskId, input.taskId));

      return Promise.all(
        results.map(async (proof) => {
          const [agentResult, submissionResult] = await Promise.all([
            ctx.db.select().from(agents).where(lowerAddressEq(proof.workerAddress)).limit(1),
            ctx.db
              .select({ id: submissions.id })
              .from(submissions)
              .where(
                and(
                  eq(submissions.taskId, proof.taskId),
                  eq(submissions.workerAddress, proof.workerAddress),
                  eq(submissions.fileUrl, `taskmarket-proof:${proof.id}`)
                )
              )
              .limit(1),
          ]);

          return {
            id: proof.id,
            taskId: proof.taskId,
            workerAddress: proof.workerAddress,
            proofData: proof.proofData,
            proofType: proof.proofType as any,
            metricValue: proof.metricValue,
            status: proof.status as any,
            submissionId: submissionResult[0]?.id ?? null,
            submittedAt: proof.submittedAt.toISOString(),
            workerAgentId: agentResult[0]?.agentId ?? null,
          };
        })
      );
    }),
});
