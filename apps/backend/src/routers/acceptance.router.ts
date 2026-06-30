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

      // Resolve the deliverable hash. For bounty/benchmark the contract verifies
      // the hash against its on-chain submission history, so we always derive it
      // from the DB (never from the caller). For claim/pitch/auction the contract
      // reads task.deliverable directly and ignores the value we pass.
      let deliverable: `0x${string}` = `0x${'00'.repeat(32)}` as `0x${string}`;
      if (task.mode === 'bounty' || task.mode === 'benchmark') {
        const submissionRow = await ctx.db
          .select({ deliverableHash: submissions.deliverableHash })
          .from(submissions)
          .where(
            and(
              eq(submissions.taskId, input.taskId),
              eq(submissions.workerAddress, input.worker),
              sql`${submissions.rejectedAt} IS NULL`
            )
          )
          .orderBy(sql`${submissions.submittedAt} DESC`)
          .limit(1);
        const hash = submissionRow[0]?.deliverableHash;
        if (!hash) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No active submission found for worker ${input.worker} on task ${input.taskId}`,
          });
        }
        deliverable = hash as `0x${string}`;
      } else {
        // Claim/pitch/auction: deliverable stored in task.deliverable on-chain at submitWork time.
        // Contract ignores this param for these modes; pass zeros.
        deliverable = `0x${'00'.repeat(32)}` as `0x${string}`;
      }

      // Look up requester's ERC-8004 agentId for reputation tracking (0 if not found).
      const requesterAgentRow = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(sql`lower(${agents.address}) = lower(${payer})`)
        .limit(1);
      const requesterOnChainId = requesterAgentRow[0]?.agentId
        ? BigInt(requesterAgentRow[0].agentId)
        : 0n;

      await contractAcceptSubmission(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        input.worker as `0x${string}`,
        deliverable,
        requesterOnChainId,
        task.contractAddress
      );

      // Detect self-award: same address OR same ERC-8004 agentId (sybil case).
      const workerAgentRow = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(sql`lower(${agents.address}) = lower(${input.worker})`)
        .limit(1);
      const workerOnChainId = workerAgentRow[0]?.agentId;
      const isSelfAward =
        payer.toLowerCase() === input.worker.toLowerCase() ||
        (requesterAgentRow[0]?.agentId != null &&
          workerOnChainId != null &&
          requesterAgentRow[0].agentId === workerOnChainId);

      if (isSelfAward) {
        await ctx.db.update(tasks).set({ selfAward: true }).where(eq(tasks.id, input.taskId));
      }

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

      const workers: `0x${string}`[] = input.winners.map((w) => w.worker as `0x${string}`);
      const shares: number[] = input.winners.map((w) => w.share);

      // Look up requester's ERC-8004 agentId for on-chain reputation tracking.
      const requesterAgentRow = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(sql`lower(${agents.address}) = lower(${payer})`)
        .limit(1);
      const requesterAgentId = requesterAgentRow[0]?.agentId
        ? BigInt(requesterAgentRow[0].agentId)
        : 0n;

      await contractAcceptSubmissions(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        workers,
        shares,
        requesterAgentId,
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
