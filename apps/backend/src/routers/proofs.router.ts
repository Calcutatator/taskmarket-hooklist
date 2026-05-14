import { router, publicProcedure } from '../trpc';
import { ProofSubmitSchema, ProofResponseSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { proofs, tasks, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';
import { TRPCError } from '@trpc/server';
import { contractSubmitProof } from '../services/contract';
import { buildProofHash } from '../lib/canonical-hashes';

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
    .output(z.object({ success: z.boolean(), proofId: z.string() }))
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

      const submitTxHash = await contractSubmitProof(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        proofHash,
        proofTypeBytes32,
        metricValueBig,
        task.contractAddress
      );

      await ctx.db.insert(proofs).values({
        id: proofId,
        taskId: input.taskId,
        workerAddress: input.workerAddress,
        proofData: input.proofData,
        proofType: input.proofType,
        metricValue: input.metricValue || null,
        signature: input.signature,
        status: 'pending',
        proofHash,
        submitTxHash,
      });

      return { success: true, proofId };
    }),

  listByTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .output(z.array(ProofResponseSchema))
    .query(async ({ input, ctx }) => {
      const results = await ctx.db.select().from(proofs).where(eq(proofs.taskId, input.taskId));

      return Promise.all(
        results.map(async (proof) => {
          const agentResult = await ctx.db
            .select()
            .from(agents)
            .where(eq(agents.address, proof.workerAddress))
            .limit(1);

          return {
            id: proof.id,
            taskId: proof.taskId,
            workerAddress: proof.workerAddress,
            proofData: proof.proofData,
            proofType: proof.proofType as any,
            metricValue: proof.metricValue,
            status: proof.status as any,
            submittedAt: proof.submittedAt.toISOString(),
            workerAgentId: agentResult[0]?.agentId ?? null,
          };
        })
      );
    }),

  verify: publicProcedure
    .input(
      z.object({
        proofId: z.string(),
        taskId: z.string(),
        txHash: z.string(),
      })
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.update(proofs).set({ status: 'verified' }).where(eq(proofs.id, input.proofId));

      await ctx.db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, input.taskId));

      return { success: true };
    }),
});
