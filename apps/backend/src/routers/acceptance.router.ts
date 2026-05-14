import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { tasks, agents, platformFees, feedbacks } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { contractAcceptSubmission, contractRateTask } from '../services/contract';
import { getServerConfig } from '../config/env';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';

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
    .input(
      z.object({
        taskId: z.string(),
        worker: z.string(),
      })
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new Error('Payment required: missing payer');
      }

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new Error('Task not found');
      }

      const task = taskResult[0];

      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the task requester can accept a submission');
      }

      const txHash = await contractAcceptSubmission(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        input.worker as `0x${string}`,
        task.contractAddress
      );

      await ctx.db
        .update(tasks)
        .set({
          status: 'accepted',
          worker: input.worker,
        })
        .where(eq(tasks.id, input.taskId));

      const agentResult = await ctx.db
        .select()
        .from(agents)
        .where(eq(agents.address, input.worker))
        .limit(1);

      if (agentResult.length === 0) {
        await ctx.db.insert(agents).values({
          address: input.worker,
          completedTasks: 1,
          totalEarnings: task.reward,
          skills: task.tags ?? [],
        });
      } else {
        const tags = task.tags ?? [];
        const skillsExpr =
          tags.length === 0
            ? sql`${agents.skills}`
            : sql`ARRAY(SELECT DISTINCT unnest(${agents.skills} || ARRAY[${sql.join(
                tags.map((t) => sql`${t}`),
                sql`, `
              )}]))`;
        await ctx.db
          .update(agents)
          .set({
            completedTasks: sql`${agents.completedTasks} + 1`,
            totalEarnings: sql`${agents.totalEarnings} + ${task.reward}`,
            skills: skillsExpr,
            updatedAt: new Date(),
          })
          .where(eq(agents.address, input.worker));
      }

      await ctx.db.insert(platformFees).values({
        taskId: input.taskId,
        amount: '0',
        txHash,
      });

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
    .input(
      z.object({
        taskId: z.string(),
        worker: z.string(),
        rating: z.number().int().min(0).max(100),
        feedbackText: z.string().max(500).optional(),
      })
    )
    .output(z.object({ success: z.boolean(), feedbackId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new Error('Payment required: missing payer');
      }

      const config = getServerConfig();

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (
        taskResult.length === 0 ||
        (taskResult[0].status !== 'accepted' && taskResult[0].status !== 'completed')
      ) {
        throw new Error('Task not accepted');
      }

      const task = taskResult[0];

      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new Error('Only the task requester can rate a task');
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
