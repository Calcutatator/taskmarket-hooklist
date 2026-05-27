import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  contractEvaluate,
  contractAppeal,
  contractFinalizeVerdict,
  contractResolveDispute,
  contractEvaluatorTimeout,
} from '../services/contract';

const VERDICT_MAP: Record<string, number> = { approve: 0, reject: 1, partial: 2 };

const AwardInputSchema = z.object({
  worker: z.string(),
  amount: z.string(),
  rank: z.number().int().min(1),
});

export const evaluationsRouter = router({
  evaluate: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/evaluate',
        tags: ['Evaluations'],
        summary: 'Submit evaluation verdict (X402 required)',
      },
    })
    .input(
      z.object({
        taskId: z.string(),
        verdict: z.enum(['approve', 'reject', 'partial']),
        score: z.number().int().min(0).max(1000).optional().default(1000),
        confidence: z.number().int().min(0).max(1000).optional().default(1000),
        evidenceHash: z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .optional()
          .default('0x0000000000000000000000000000000000000000000000000000000000000000'),
        awards: z.array(AwardInputSchema).optional().default([]),
      })
    )
    .output(z.object({ txHash: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) throw new Error('Payment required: missing payer');

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      if (taskResult.length === 0) throw new Error('Task not found');
      const task = taskResult[0];

      const isOpenModeEval =
        (task.mode === 'bounty' || task.mode === 'benchmark') && task.status === 'open';
      const isReviewModeEval = task.status === 'review';
      if (!isOpenModeEval && !isReviewModeEval) {
        throw new Error('Task is not in an evaluatable state');
      }

      if (!task.evaluator || task.evaluator.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the assigned evaluator can evaluate this task');
      }

      const awards = input.awards.map((a) => ({
        worker: a.worker as `0x${string}`,
        amount: BigInt(a.amount),
        rank: a.rank,
      }));

      const txHash = await contractEvaluate(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        VERDICT_MAP[input.verdict] ?? 0,
        input.score,
        input.confidence,
        input.evidenceHash as `0x${string}`,
        awards
      );

      const appealDeadline =
        task.appealWindow != null ? new Date(Date.now() + task.appealWindow * 1000) : null;
      await ctx.db
        .update(tasks)
        .set({
          status: 'appealing',
          verdictType: input.verdict.toUpperCase(),
          verdictScore: input.score,
          verdictConfidence: input.confidence,
          verdictEvidenceHash: input.evidenceHash,
          evaluatorStake: '0',
          appealDeadline,
        })
        .where(eq(tasks.id, input.taskId));

      return { txHash };
    }),

  appeal: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/appeal',
        tags: ['Evaluations'],
        summary: 'Appeal an evaluator verdict (X402 required)',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(z.object({ txHash: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) throw new Error('Payment required: missing payer');

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      if (taskResult.length === 0) throw new Error('Task not found');
      const task = taskResult[0];

      if (!task.worker || task.worker.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the task worker can appeal');
      }
      if (task.status !== 'appealing') throw new Error('Task is not in Appealing state');

      const txHash = await contractAppeal(input.taskId as `0x${string}`, payer as `0x${string}`);
      await ctx.db.update(tasks).set({ status: 'disputed' }).where(eq(tasks.id, input.taskId));
      return { txHash };
    }),

  finalizeVerdict: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/finalize-verdict',
        tags: ['Evaluations'],
        summary: 'Finalize verdict after appeal window expires',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(z.object({ txHash: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      if (taskResult.length === 0) throw new Error('Task not found');
      const task = taskResult[0];

      if (task.status !== 'appealing') throw new Error('Task is not in Appealing state');
      if (task.appealDeadline && task.appealDeadline > new Date()) {
        throw new Error('Appeal window not yet expired');
      }

      const txHash = await contractFinalizeVerdict(input.taskId as `0x${string}`);

      const newStatus = task.verdictType === 'REJECT' ? 'open' : 'completed';
      await ctx.db.update(tasks).set({ status: newStatus }).where(eq(tasks.id, input.taskId));

      return { txHash };
    }),

  resolveDispute: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/resolve-dispute',
        tags: ['Evaluations'],
        summary: 'Resolve a disputed task (X402 required)',
      },
    })
    .input(
      z.object({
        taskId: z.string(),
        verdict: z.enum(['approve', 'partial']),
        awards: z.array(AwardInputSchema).min(1),
      })
    )
    .output(z.object({ txHash: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) throw new Error('Payment required: missing payer');

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      if (taskResult.length === 0) throw new Error('Task not found');
      const task = taskResult[0];

      if (!task.disputeResolver || task.disputeResolver.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the dispute resolver can resolve this dispute');
      }
      if (task.status !== 'disputed') throw new Error('Task is not in Disputed state');

      const awards = input.awards.map((a) => ({
        worker: a.worker as `0x${string}`,
        amount: BigInt(a.amount),
        rank: a.rank,
      }));

      const txHash = await contractResolveDispute(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        VERDICT_MAP[input.verdict] ?? 0,
        awards
      );

      await ctx.db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, input.taskId));
      return { txHash };
    }),

  evaluatorTimeout: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/evaluator-timeout',
        tags: ['Evaluations'],
        summary: 'Trigger evaluator timeout (X402 required)',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(z.object({ txHash: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) throw new Error('Payment required: missing payer');

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      if (taskResult.length === 0) throw new Error('Task not found');
      const task = taskResult[0];

      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the requester can trigger evaluator timeout');
      }
      if (task.status !== 'review') throw new Error('Task is not in Review state');
      if (!task.evaluatorDeadline || task.evaluatorDeadline > new Date()) {
        throw new Error('Evaluator deadline has not yet passed');
      }

      const txHash = await contractEvaluatorTimeout(
        input.taskId as `0x${string}`,
        payer as `0x${string}`
      );

      await ctx.db
        .update(tasks)
        .set({ status: 'pending_approval', evaluatorStake: '0', evaluatorDeadline: null })
        .where(eq(tasks.id, input.taskId));

      return { txHash };
    }),
});
