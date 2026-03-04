import { router, publicProcedure } from '../trpc';
import { ProofSubmitSchema, ProofResponseSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { proofs, tasks, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { recoverMessageAddress } from 'viem';
import { TRPCError } from '@trpc/server';

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

      const message = `taskmarket:proof:${input.taskId}`;
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message,
          signature: input.signature as `0x${string}`,
        });
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' });
      }
      if (signer.toLowerCase() !== input.workerAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Signature does not match worker address',
        });
      }

      const proofId = randomUUID();

      await ctx.db.insert(proofs).values({
        id: proofId,
        taskId: input.taskId,
        workerAddress: input.workerAddress,
        proofData: input.proofData,
        proofType: input.proofType,
        metricValue: input.metricValue || null,
        signature: input.signature,
        status: 'pending',
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

      await ctx.db.update(tasks).set({ status: 'accepted' }).where(eq(tasks.id, input.taskId));

      return { success: true };
    }),
});
