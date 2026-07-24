import { router, publicProcedure, optionalAuthProcedure } from '../trpc';
import { ProofSubmitSchema, ProofResponseSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { proofs, submissions, tasks, agents } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';
import { TRPCError } from '@trpc/server';
import { contractSubmitProof, contractSubmitWork } from '../services/contract';
import { buildProofHash } from '../lib/canonical-hashes';
import { lowerAddressEq } from '../lib/agents';
import { resolveTaskViewability } from '../lib/task-visibility';

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

      const proofTxHash = await contractSubmitProof(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        proofHash,
        proofTypeBytes32,
        metricValueBig,
        task.contractAddress
      );

      // Benchmark acceptance is based on submitWork commitments. Register the
      // canonical proof hash as the deliverable so a proof-only entry can be
      // accepted without a separate artifact upload.
      let submissionTxHash: `0x${string}`;
      try {
        submissionTxHash = await contractSubmitWork(
          input.taskId as `0x${string}`,
          input.workerAddress as `0x${string}`,
          proofHash,
          task.contractAddress
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Proof anchored onchain (${proofTxHash}) but deliverable commitment failed: ${reason}`,
        });
      }

      try {
        await ctx.db.transaction(async (tx) => {
          await tx.insert(proofs).values({
            id: proofId,
            taskId: input.taskId,
            workerAddress: input.workerAddress,
            proofData: input.proofData,
            proofType: input.proofType,
            metricValue: input.metricValue || null,
            signature: input.signature,
            status: 'pending',
            proofHash,
            submitTxHash: proofTxHash,
          });

          await tx.insert(submissions).values({
            id: submissionId,
            taskId: input.taskId,
            workerAddress: input.workerAddress,
            fileUrl: `taskmarket-proof:${proofId}`,
            signature: input.signature,
            deliverableHash: proofHash,
            submitTxHash: submissionTxHash,
          });
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Proof and deliverable anchored onchain (${proofTxHash}, ${submissionTxHash}) but database sync failed: ${reason}`,
        });
      }

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
