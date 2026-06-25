import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { tasks, agents, feedbacks, submissions } from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import {
  contractAcceptSubmission,
  contractAcceptSubmissions,
  contractRateTask,
} from '../services/contract';
import { getServerConfig } from '../config/env';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';
import {
  AcceptInputSchema,
  AcceptSubmissionsInputSchema,
  RateInputSchema,
} from '../schemas/acceptance.schemas';

function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.keys(obj as object)
        .sort()
        .map((k) => [k, sortKeys((obj as Record<string, unknown>)[k])])
    );
  }
  return obj;
}

export const acceptanceRouter = router({
  accept: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/accept',
        tags: ['Tasks'],
        summary: 'Accept submission (X402 required)',
      },
    })
    .input(AcceptInputSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Payment required: missing payer' });
      }

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];

      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the task requester can accept a submission',
        });
      }

      // Resolve the deliverable hash to commit. Order:
      // 1. Explicit input.deliverable (CLI / web pass it through)
      // 2. The submissions row for (taskId, worker) (backend lookup)
      let deliverable: `0x${string}` =
        (input.deliverable as `0x${string}` | undefined) ?? `0x${'00'.repeat(32)}`;
      if (!input.deliverable) {
        const submissionRow = await ctx.db
          .select({ deliverableHash: submissions.deliverableHash })
          .from(submissions)
          .where(
            and(eq(submissions.taskId, input.taskId), eq(submissions.workerAddress, input.worker))
          )
          .orderBy(sql`${submissions.submittedAt} DESC`)
          .limit(1);
        if (submissionRow[0]?.deliverableHash) {
          deliverable = submissionRow[0].deliverableHash as `0x${string}`;
        }
      }

      const ZERO_HASH = `0x${'00'.repeat(32)}` as `0x${string}`;
      if (deliverable === ZERO_HASH && (task.mode === 'bounty' || task.mode === 'benchmark')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `No deliverable found for worker ${input.worker} on task ${input.taskId}. Bounty and benchmark tasks require a non-zero deliverable hash.`,
        });
      }

      await contractAcceptSubmission(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        input.worker as `0x${string}`,
        deliverable,
        task.contractAddress
      );

      // No DB writes here — the indexer is the sole writer of task state.
      // It will set status to 'completed' and update agent stats when it
      // processes the TaskCompleted on-chain event.
      return { success: true };
    }),

  acceptSubmissions: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/accept-submissions',
        tags: ['Tasks'],
        summary: 'Accept N submissions at once with explicit share basis points (X402 required)',
      },
    })
    .input(AcceptSubmissionsInputSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Payment required: missing payer' });
      }

      const sumShares = input.winners.reduce((acc, w) => acc + w.share, 0);
      if (sumShares !== 10000) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Winner shares must sum to 10000 basis points (got ${sumShares})`,
        });
      }

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }
      const task = taskResult[0];
      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the task requester can accept submissions',
        });
      }

      // Resolve each winner's deliverable hash. Priority:
      // 1. Explicit input.winners[i].deliverable
      // 2. submissions row by input.winners[i].submissionId
      // 3. latest submissions row for (taskId, worker)
      // 4. error — we can't accept without a deliverable
      const workers: `0x${string}`[] = [];
      const shares: number[] = [];
      const deliverables: `0x${string}`[] = [];

      for (const w of input.winners) {
        workers.push(w.worker as `0x${string}`);
        shares.push(w.share);

        let deliverable: `0x${string}` | null = null;
        if (w.deliverable) {
          deliverable = w.deliverable as `0x${string}`;
        } else if (w.submissionId) {
          const row = await ctx.db
            .select({ deliverableHash: submissions.deliverableHash })
            .from(submissions)
            .where(
              and(
                eq(submissions.id, w.submissionId),
                eq(submissions.taskId, input.taskId),
                eq(submissions.workerAddress, w.worker)
              )
            )
            .limit(1);
          deliverable = (row[0]?.deliverableHash as `0x${string}` | undefined) ?? null;
        } else {
          const row = await ctx.db
            .select({ deliverableHash: submissions.deliverableHash })
            .from(submissions)
            .where(
              and(eq(submissions.taskId, input.taskId), eq(submissions.workerAddress, w.worker))
            )
            .orderBy(sql`${submissions.submittedAt} DESC`)
            .limit(1);
          deliverable = (row[0]?.deliverableHash as `0x${string}` | undefined) ?? null;
        }
        if (!deliverable) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No deliverable found for worker ${w.worker}; pass deliverable or submissionId explicitly`,
          });
        }
        deliverables.push(deliverable);
      }

      await contractAcceptSubmissions(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        workers,
        shares,
        deliverables,
        task.contractAddress
      );

      return { success: true };
    }),

  rate: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/rate',
        tags: ['Tasks'],
        summary: 'Rate task (X402 required)',
      },
    })
    .input(RateInputSchema)
    .output(z.object({ success: z.boolean(), feedbackId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Payment required: missing payer' });
      }

      const config = getServerConfig();

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      if (taskResult[0].status !== 'completed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not completed' });
      }

      const task = taskResult[0];

      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the task requester can rate a task',
        });
      }

      const workerAgentResult = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(eq(agents.address, input.worker))
        .limit(1);

      const workerAgentId = workerAgentResult[0]?.agentId
        ? BigInt(workerAgentResult[0].agentId)
        : 0n;

      const raterAgentId = task.requesterAgentId ? BigInt(task.requesterAgentId) : 0n;

      const feedbackId = randomUUID();
      const feedbackURI = `${config.BACKEND_URL}/api/feedback/${feedbackId}`;

      const feedbackData = sortKeys({
        agentId: workerAgentResult[0]?.agentId ? Number(workerAgentResult[0].agentId) : null,
        agentRegistry: `eip155:${config.CHAIN_ID}:${config.ERC8004_IDENTITY_REGISTRY}`,
        clientAddress: `eip155:${config.CHAIN_ID}:${config.CONTRACT_ADDRESS}`,
        createdAt: new Date().toISOString(),
        ...(input.feedbackText ? { feedback: input.feedbackText } : {}),
        proofOfPayment: {
          chainId: String(config.CHAIN_ID),
          fromAddress: task.requester,
          toAddress: config.CONTRACT_ADDRESS,
          txHash: task.escrowTxHash,
        },
        tag1: 'starred',
        taskmarket: {
          platform: config.BACKEND_URL,
          requester: task.requester,
          reward: task.reward,
          taskId: task.id,
          worker: input.worker,
        },
        value: input.rating,
        valueDecimals: 0,
      });

      const fileContent = JSON.stringify(feedbackData, null, 2);
      const feedbackHash = keccak256(toBytes(fileContent)) as `0x${string}`;

      const { hash: ratingTxHash, blockNumber: ratingBlockNumber } = await contractRateTask(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        input.worker as `0x${string}`,
        input.rating,
        workerAgentId,
        raterAgentId,
        feedbackURI,
        feedbackHash,
        task.contractAddress
      );

      await ctx.db.insert(feedbacks).values({
        id: feedbackId,
        taskId: input.taskId,
        workerAddress: input.worker,
        workerAgentId: workerAgentResult[0]?.agentId ?? null,
        requesterAddress: payer,
        requesterAgentId: task.requesterAgentId ?? null,
        rating: input.rating,
        feedbackText: input.feedbackText ?? null,
        fileContent,
        ratingTxHash,
        ratingBlockNumber,
      });

      await ctx.db.update(tasks).set({ rating: input.rating }).where(eq(tasks.id, input.taskId));

      await ctx.db
        .update(agents)
        .set({
          ratedTasks: sql`${agents.ratedTasks} + 1`,
          totalStars: sql`${agents.totalStars} + ${input.rating}`,
          updatedAt: new Date(),
        })
        .where(eq(agents.address, input.worker));

      return { success: true, feedbackId };
    }),
});
