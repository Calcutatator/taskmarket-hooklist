import { router, publicProcedure } from '../trpc';
import { ProofSubmitSchema, ProofResponseSchema } from '@clawtasker/shared';
import { z } from 'zod';
import { proofs, tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const proofsRouter = router({
  submit: publicProcedure
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

      if (task.mode !== 'race') {
        throw new Error('Not a Race task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open for proof submission');
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
      const results = await ctx.db
        .select()
        .from(proofs)
        .where(eq(proofs.taskId, input.taskId));

      return results.map((proof) => ({
        id: proof.id,
        taskId: proof.taskId,
        workerAddress: proof.workerAddress,
        proofData: proof.proofData,
        proofType: proof.proofType as any,
        metricValue: proof.metricValue,
        status: proof.status as any,
        submittedAt: proof.submittedAt.toISOString(),
      }));
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
      await ctx.db
        .update(proofs)
        .set({ status: 'verified' })
        .where(eq(proofs.id, input.proofId));

      await ctx.db
        .update(tasks)
        .set({ status: 'accepted' })
        .where(eq(tasks.id, input.taskId));

      return { success: true };
    }),
});
