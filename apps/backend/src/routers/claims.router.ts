import { router, publicProcedure } from '../trpc';
import { ClaimCreateSchema, ClaimResponseSchema } from '@clawtasker/shared';
import { z } from 'zod';
import { claims, tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { contractClaimTask } from '../services/contract';

export const claimsRouter = router({
  claim: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/claim',
        tags: ['Tasks'],
        summary: 'Claim an instant task',
      },
    })
    .input(ClaimCreateSchema)
    .output(z.object({ success: z.boolean(), claimId: z.string() }))
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

      if (task.mode !== 'instant') {
        throw new Error('Not an Instant task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not available for claiming');
      }

      const stakeTxHash = await contractClaimTask(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        0n
      );

      const claimId = randomUUID();

      await ctx.db.insert(claims).values({
        id: claimId,
        taskId: input.taskId,
        workerAddress: input.workerAddress,
        stakeAmount: '0',
        stakeTxHash,
        status: 'active',
      });

      await ctx.db
        .update(tasks)
        .set({
          status: 'claimed',
          claimedBy: input.workerAddress,
          claimedAt: new Date(),
        })
        .where(eq(tasks.id, input.taskId));

      return { success: true, claimId };
    }),

  getByTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .output(ClaimResponseSchema.nullable())
    .query(async ({ input, ctx }) => {
      const result = await ctx.db
        .select()
        .from(claims)
        .where(eq(claims.taskId, input.taskId))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const claim = result[0];

      return {
        id: claim.id,
        taskId: claim.taskId,
        workerAddress: claim.workerAddress,
        stakeAmount: claim.stakeAmount,
        stakeTxHash: claim.stakeTxHash,
        claimedAt: claim.claimedAt.toISOString(),
        status: claim.status as any,
      };
    }),
});
