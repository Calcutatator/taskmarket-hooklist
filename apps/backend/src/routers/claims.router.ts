import { router, publicProcedure } from '../trpc';
import { ClaimCreateSchema, ClaimResponseSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { claims, tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { contractClaimTask, contractForfeitAndReopen } from '../services/contract';
import { recoverMessageAddress } from 'viem';
import { TRPCError } from '@trpc/server';

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
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];

      if (task.mode !== 'claim') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a Claim task' });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not available for claiming' });
      }

      const message = `taskmarket:claim:${input.taskId}`;
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

      const stakeTxHash = await contractClaimTask(
        input.taskId as `0x${string}`,
        input.workerAddress as `0x${string}`,
        0n,
        task.contractAddress
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

  forfeit: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/forfeit',
        tags: ['Tasks'],
        summary: 'Forfeit an expired claim and reopen the task (requester only)',
      },
    })
    .input(
      z.object({
        taskId: z.string().min(1),
        requesterAddress: z.string().min(1),
        signature: z.string().min(1),
      })
    )
    .output(z.object({ txHash: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];

      if (task.mode !== 'claim') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a Claim task' });
      }

      if (task.status !== 'claimed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is not currently claimed' });
      }

      if (task.requester.toLowerCase() !== input.requesterAddress.toLowerCase()) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the task requester can forfeit' });
      }

      const message = `taskmarket:forfeit:${input.taskId}`;
      let signer: string;
      try {
        signer = await recoverMessageAddress({
          message,
          signature: input.signature as `0x${string}`,
        });
      } catch {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' });
      }
      if (signer.toLowerCase() !== input.requesterAddress.toLowerCase()) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Signature does not match requester address',
        });
      }

      const txHash = await contractForfeitAndReopen(
        input.taskId as `0x${string}`,
        input.requesterAddress as `0x${string}`,
        task.contractAddress
      );

      await ctx.db.transaction(async (tx) => {
        await tx.update(claims).set({ status: 'forfeited' }).where(eq(claims.taskId, input.taskId));
        await tx
          .update(tasks)
          .set({ status: 'open', claimedBy: null, claimedAt: null })
          .where(eq(tasks.id, input.taskId));
      });

      return { txHash };
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
