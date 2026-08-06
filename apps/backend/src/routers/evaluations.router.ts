import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import {
  AppealInputSchema,
  EvaluateInputSchema,
  EvaluatorTimeoutInputSchema,
  FinalizeVerdictInputSchema,
  ResolveDisputeInputSchema,
} from '@taskmarket/shared';
import { tasks } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  contractEvaluate,
  contractAppeal,
  contractFinalizeVerdict,
  contractResolveDispute,
  contractEvaluatorTimeout,
} from '../services/contract';
import { recordTaskSettlement } from '../services/settlement-recorder';
import { getServerConfig } from '../config/env';
import { handleStandardFeePostPaymentFailure } from '../services/orphaned-payments';
import { resolveAppealAuthorization } from '../services/task-appeal-authorization';

const VERDICT_MAP: Record<string, number> = { approve: 0, reject: 1, partial: 2 };

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
    .input(EvaluateInputSchema)
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
        (task.mode === 'bounty' || task.mode === 'benchmark') &&
        (task.status === 'open' || task.status === 'pending_approval');
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

      let txHash: `0x${string}`;
      let evaluatedAt: number;
      try {
        ({ txHash, evaluatedAt } = await contractEvaluate(
          input.taskId as `0x${string}`,
          payer as `0x${string}`,
          VERDICT_MAP[input.verdict] ?? 0,
          input.score,
          input.confidence,
          input.evidenceHash as `0x${string}`,
          awards
        ));
      } catch (error) {
        return handleStandardFeePostPaymentFailure({
          db: ctx.db,
          payer: payer as `0x${string}`,
          paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
          context: 'task_evaluate',
          error,
        });
      }

      const appealDeadline =
        task.appealWindow != null ? new Date((evaluatedAt + task.appealWindow) * 1000) : null;
      const expiryTime =
        appealDeadline && appealDeadline > task.expiryTime ? appealDeadline : task.expiryTime;
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
          expiryTime,
          // The contract only reassigns the worker for contest modes
          // (EvaluatorFacet.evaluate); mirror that so locked-worker modes keep
          // the on-chain worker and the appeal window stays usable.
          claimedBy:
            task.mode === 'bounty' || task.mode === 'benchmark'
              ? (input.awards[0]?.worker ?? task.claimedBy)
              : task.claimedBy,
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
    .input(AppealInputSchema)
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

      const preflight = ctx.res.locals.taskActionPreflight as
        | { action?: string; payer?: string }
        | undefined;
      const authorization =
        preflight?.action === 'appeal' && preflight.payer === payer.toLowerCase()
          ? ({ authorized: true, authority: 'worker' } as const)
          : await resolveAppealAuthorization(task, payer);
      if (!authorization.authorized) {
        if (authorization.authority === 'unverified') {
          throw new Error('Unable to verify appeal eligibility');
        }
        throw new Error(
          authorization.authority === 'worker'
            ? 'Only the task worker can appeal'
            : 'Only a task submitter can appeal'
        );
      }
      if (task.status !== 'appealing') throw new Error('Task is not in Appealing state');

      let txHash: `0x${string}`;
      try {
        txHash = await contractAppeal(input.taskId as `0x${string}`, payer as `0x${string}`);
      } catch (error) {
        return handleStandardFeePostPaymentFailure({
          db: ctx.db,
          payer: payer as `0x${string}`,
          paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
          context: 'task_appeal',
          error,
        });
      }
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
    .input(FinalizeVerdictInputSchema)
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

      const { txHash, settlement, settledAt } = await contractFinalizeVerdict(
        input.taskId as `0x${string}`
      );

      const rejected = task.verdictType === 'REJECT';
      if (rejected) {
        // REJECT refunds the (post-evaluator-fee) remainder to the requester and
        // terminates the task -- it does not reopen it. A worker who claimed a
        // reopened task would find acceptSubmission reverting on the empty
        // escrow left behind by the refund (EvaluatorFacet.finalizeVerdict).
        // The contract emits no TaskCompleted event on this path, so there is
        // no settlement to record.
        await ctx.db
          .update(tasks)
          .set({
            status: 'cancelled',
            claimedBy: null,
            evaluator: null,
            evaluatorStake: '0',
            evaluationWindow: null,
            appealWindow: null,
            evaluatorDeadline: null,
            appealDeadline: null,
          })
          .where(eq(tasks.id, input.taskId));
      } else if (settlement && settledAt != null) {
        // Record task_awards synchronously from the same receipt this mutation
        // already waited for, instead of relying solely on the async indexer to
        // pick up the TaskCompleted event(s) on its next poll -- idempotent via
        // recordTaskSettlement's onConflictDoNothing, safe if the indexer later
        // processes the same event too.
        await recordTaskSettlement(ctx.db, {
          chainId: getServerConfig().CHAIN_ID,
          settledAt: new Date(settledAt * 1000),
          settlement,
        });
      } else {
        // All-zero-award verdict: the contract still transitions the task to
        // Accepted/completed, but emits no TaskCompleted log, so there is no
        // settlement to record.
        await ctx.db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, input.taskId));
      }

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
    .input(ResolveDisputeInputSchema)
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

      let txHash: `0x${string}`;
      let settlement: Awaited<ReturnType<typeof contractResolveDispute>>['settlement'];
      let settledAt: number | null;
      try {
        ({ txHash, settlement, settledAt } = await contractResolveDispute(
          input.taskId as `0x${string}`,
          payer as `0x${string}`,
          VERDICT_MAP[input.verdict] ?? 0,
          awards
        ));
      } catch (error) {
        return handleStandardFeePostPaymentFailure({
          db: ctx.db,
          payer: payer as `0x${string}`,
          paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
          context: 'task_resolve_dispute',
          error,
        });
      }

      if (settlement && settledAt != null) {
        // Record task_awards synchronously from the same receipt this mutation
        // already waited for, instead of relying solely on the async indexer to
        // pick up the TaskCompleted event(s) on its next poll -- idempotent via
        // recordTaskSettlement's onConflictDoNothing, safe if the indexer later
        // processes the same event too.
        await recordTaskSettlement(ctx.db, {
          chainId: getServerConfig().CHAIN_ID,
          settledAt: new Date(settledAt * 1000),
          settlement,
        });
      } else {
        // All-zero-award verdict: the contract still transitions the task to
        // Accepted/completed, but emits no TaskCompleted log, so there is no
        // settlement to record.
        await ctx.db
          .update(tasks)
          .set({ status: 'completed', claimedBy: input.awards[0].worker })
          .where(eq(tasks.id, input.taskId));
      }
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
    .input(EvaluatorTimeoutInputSchema)
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
      if (!task.evaluatorDeadline || task.evaluatorDeadline >= new Date()) {
        throw new Error('Evaluator deadline has not yet passed');
      }

      let txHash: `0x${string}`;
      try {
        txHash = await contractEvaluatorTimeout(
          input.taskId as `0x${string}`,
          payer as `0x${string}`
        );
      } catch (error) {
        return handleStandardFeePostPaymentFailure({
          db: ctx.db,
          payer: payer as `0x${string}`,
          paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
          context: 'task_evaluator_timeout',
          error,
        });
      }

      await ctx.db
        .update(tasks)
        .set({
          status: 'pending_approval',
          evaluator: null,
          evaluatorStake: '0',
          evaluatorDeadline: null,
        })
        .where(eq(tasks.id, input.taskId));

      return { txHash };
    }),
});
