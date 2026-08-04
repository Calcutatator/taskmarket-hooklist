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
  contractFinalizeVerdictTx,
  contractResolveDispute,
  contractEvaluatorTimeout,
} from '../services/contract';
import { settledPaymentReference } from '../middleware/x402';
import { runRelayedIntent } from '../services/relayed-intent-request';
// Shared with the rebroadcast path rather than duplicated here, so the first send and every
// retry of it map a verdict to the same on-chain enum (ADR-0050).
import { VERDICT_MAP } from '../services/intents/evaluations-intents';
import { RELAYED_WRITE_REQUEST_HEADERS } from '../lib/openapi-headers';
import type {
  EvaluationsAppealIntentPayload,
  EvaluationsEvaluateIntentPayload,
  EvaluationsEvaluatorTimeoutIntentPayload,
  EvaluationsFinalizeVerdictIntentPayload,
  EvaluationsResolveDisputeIntentPayload,
} from '../services/intents/evaluations-intents';

export const evaluationsRouter = router({
  evaluate: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'evaluations.evaluate',
        payer,
        payment: settledPaymentReference(ctx.res),
        payload: {
          awards: input.awards.map((a) => ({
            amount: a.amount,
            rank: a.rank,
            worker: a.worker,
          })),
          confidence: input.confidence,
          evidenceHash: input.evidenceHash,
          mode: task.mode,
          score: input.score,
          taskId: input.taskId,
          verdict: input.verdict,
        } satisfies EvaluationsEvaluateIntentPayload,
        send: async () =>
          (
            await contractEvaluate(
              input.taskId as `0x${string}`,
              payer as `0x${string}`,
              VERDICT_MAP[input.verdict] ?? 0,
              input.score,
              input.confidence,
              input.evidenceHash as `0x${string}`,
              awards
            )
          ).txHash,
      });

      return { txHash };
    }),

  appeal: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      if (!task.claimedBy || task.claimedBy.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the task worker can appeal');
      }
      if (task.status !== 'appealing') throw new Error('Task is not in Appealing state');

      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'evaluations.appeal',
        payer,
        payment: settledPaymentReference(ctx.res),
        payload: { taskId: input.taskId } satisfies EvaluationsAppealIntentPayload,
        send: () => contractAppeal(input.taskId as `0x${string}`, payer as `0x${string}`),
      });

      return { txHash };
    }),

  finalizeVerdict: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      // Permissionless, and an intent all the same. An intent records what the server
      // relayed: the transaction is sent by the server wallet either way, and the settlement it
      // produces has to reach the database whether or not this request is still around to write
      // it (ADR-0045). Free, so nothing here is refundable.
      //
      // The initiator is recorded only when the caller identified themselves with the ADR-0023
      // read-auth headers, and is null otherwise. This does not gate the call -- the endpoint
      // stays permissionless, and an anonymous caller is served exactly as before. What
      // identifying yourself buys is the ability to ask about the write afterwards: ADR-0059
      // scopes `intents.get` to the recorded initiator, so a row with none is readable by
      // nobody, which is the honest answer rather than a rule invented to fill the space.
      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'evaluations.finalizeVerdict',
        payer: ctx.caller?.address,
        payload: {
          rejected: task.verdictType === 'REJECT',
          taskId: input.taskId,
        } satisfies EvaluationsFinalizeVerdictIntentPayload,
        send: () => contractFinalizeVerdictTx(input.taskId as `0x${string}`),
      });

      return { txHash };
    }),

  resolveDispute: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'evaluations.resolveDispute',
        payer,
        payment: settledPaymentReference(ctx.res),
        // The whole decision, not just the part the completion happens to read. A payload that
        // records only a projection of the call cannot be turned back into the call, which is
        // what a rebroadcast needs (ADR-0050).
        payload: {
          awards: input.awards.map((a) => ({
            amount: a.amount,
            rank: a.rank,
            worker: a.worker,
          })),
          firstAwardWorker: input.awards[0].worker,
          taskId: input.taskId,
          verdict: input.verdict,
        } satisfies EvaluationsResolveDisputeIntentPayload,
        send: async () =>
          (
            await contractResolveDispute(
              input.taskId as `0x${string}`,
              payer as `0x${string}`,
              VERDICT_MAP[input.verdict] ?? 0,
              awards
            )
          ).txHash,
      });

      return { txHash };
    }),

  evaluatorTimeout: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'evaluations.evaluatorTimeout',
        payer,
        payment: settledPaymentReference(ctx.res),
        payload: { taskId: input.taskId } satisfies EvaluationsEvaluatorTimeoutIntentPayload,
        send: () => contractEvaluatorTimeout(input.taskId as `0x${string}`, payer as `0x${string}`),
      });

      return { txHash };
    }),
});
