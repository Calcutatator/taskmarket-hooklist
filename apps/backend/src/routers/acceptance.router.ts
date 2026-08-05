import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { tasks, taskAwards, agents, submissions } from '../db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
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
import { settledPaymentReference } from '../middleware/x402';
import { runRelayedIntent } from '../services/relayed-intent-request';
import { RELAYED_WRITE_REQUEST_HEADERS } from '../lib/openapi-headers';
import type {
  AcceptanceAcceptIntentPayload,
  AcceptanceAcceptSubmissionsIntentPayload,
  AcceptanceRateIntentPayload,
} from '../services/intents/acceptance-intents';

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
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      // Resolve the deliverable hash from DB. The contract always checks that
      // the deliverable arg matches task.deliverable on-chain (set by submitWork),
      // so we must pass the actual hash for all modes.
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
      const deliverable = hash as `0x${string}`;

      // Look up requester's ERC-8004 agentId for reputation tracking (0 if not found).
      const requesterAgentRow = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(sql`lower(${agents.address}) = lower(${payer})`)
        .limit(1);
      const requesterOnChainId = requesterAgentRow[0]?.agentId
        ? BigInt(requesterAgentRow[0].agentId)
        : 0n;

      // Detect self-award: same address OR same ERC-8004 agentId (sybil case). Resolved
      // before the chain call so the intent's payload carries everything its completion
      // needs, whether that runs here or from the reconciler hours later (ADR-0045).
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

      await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'acceptance.accept',
        payer,
        payment: settledPaymentReference(ctx.res),
        // The deliverable hash is recorded, not left to be re-resolved later: the query above
        // picks the newest unrejected submission, and on a bounty that is a different worker's
        // work by the time a rebroadcast runs. What the requester accepted is a fact about
        // this request, so it belongs on the row (ADR-0050).
        payload: {
          contractAddress: task.contractAddress,
          deliverableHash: deliverable,
          isSelfAward,
          requester: payer,
          requesterAgentId: requesterAgentRow[0]?.agentId ?? null,
          taskId: input.taskId,
          worker: input.worker,
        } satisfies AcceptanceAcceptIntentPayload,
        send: () =>
          contractAcceptSubmission(
            input.taskId as `0x${string}`,
            payer as `0x${string}`,
            input.worker as `0x${string}`,
            deliverable,
            requesterOnChainId,
            task.contractAddress
          ),
      });

      return { success: true };
    }),

  acceptSubmissions: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      // Resolve per-winner deliverable hashes. When a submissionId is provided, look up the
      // on-chain hash from the DB and pass it to the contract for pinning. When absent, pass
      // bytes32(0) so the contract auto-resolves the worker's latest submission.
      const ZERO_HASH = `0x${'00'.repeat(32)}` as `0x${string}`;
      const deliverables: `0x${string}`[] = await Promise.all(
        input.winners.map(async (w) => {
          if (!w.submissionId) return ZERO_HASH;
          const row = await ctx.db
            .select({ deliverableHash: submissions.deliverableHash })
            .from(submissions)
            .where(
              and(
                eq(submissions.id, w.submissionId),
                eq(submissions.taskId, input.taskId),
                sql`lower(${submissions.workerAddress}) = lower(${w.worker})`,
                isNull(submissions.rejectedAt)
              )
            )
            .limit(1);
          if (!row[0]) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Submission ${w.submissionId} not found for worker ${w.worker} on task ${input.taskId}`,
            });
          }
          if (!row[0].deliverableHash) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Submission ${w.submissionId} predates on-chain hash tracking and cannot be pinned`,
            });
          }
          return row[0].deliverableHash as `0x${string}`;
        })
      );

      // Look up requester's ERC-8004 agentId for on-chain reputation tracking.
      const requesterAgentRow = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(sql`lower(${agents.address}) = lower(${payer})`)
        .limit(1);
      const requesterAgentId = requesterAgentRow[0]?.agentId
        ? BigInt(requesterAgentRow[0].agentId)
        : 0n;

      await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'acceptance.acceptSubmissions',
        payer,
        payment: settledPaymentReference(ctx.res),
        payload: {
          contractAddress: task.contractAddress,
          deliverables,
          requester: payer,
          requesterAgentId: requesterAgentRow[0]?.agentId ?? null,
          taskId: input.taskId,
          winners: input.winners,
        } satisfies AcceptanceAcceptSubmissionsIntentPayload,
        send: () =>
          contractAcceptSubmissions(
            input.taskId as `0x${string}`,
            payer as `0x${string}`,
            workers,
            shares,
            deliverables,
            requesterAgentId,
            task.contractAddress
          ),
      });

      return { success: true };
    }),

  rate: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      const awards = await ctx.db
        .select({ workerAddress: taskAwards.workerAddress, rating: taskAwards.rating })
        .from(taskAwards)
        .where(eq(taskAwards.taskId, input.taskId));
      const matchingAwards = awards.filter(
        (award) => award.workerAddress.toLowerCase() === input.worker.toLowerCase()
      );
      if (
        (awards.length > 0 && matchingAwards.length === 0) ||
        (awards.length === 0 && task.claimedBy?.toLowerCase() !== input.worker.toLowerCase())
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Worker is not an award recipient for this task',
        });
      }

      if (matchingAwards.some((award) => award.rating !== null)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Award recipient is already rated' });
      }

      const workerAgentResult = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(sql`lower(${agents.address}) = lower(${input.worker})`)
        .limit(1);

      const workerAgentId = workerAgentResult[0]?.agentId
        ? BigInt(workerAgentResult[0].agentId)
        : 0n;

      const raterAgentId = task.requesterAgentId ? BigInt(task.requesterAgentId) : 0n;

      // `feedbackId` seeds `feedbackURI`, and the `createdAt` clock below seeds `fileContent`
      // and therefore `feedbackHash`, so four payload fields move between two attempts of one
      // request. Under ADR-0061 that reads as a different write -- and it stays unreachable
      // only because this is a paid route, where the pre-settlement check in x402Middleware
      // refuses a repeated key before the handler runs. Making this write free means deriving
      // the id and pinning the timestamp first, or every retry of a rating is refused.
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

      await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'acceptance.rate',
        payer,
        payment: settledPaymentReference(ctx.res),
        payload: {
          contractAddress: task.contractAddress,
          feedbackHash,
          feedbackId,
          feedbackText: input.feedbackText ?? null,
          feedbackURI,
          fileContent,
          rating: input.rating,
          requesterAddress: payer.toLowerCase(),
          requesterAgentId: task.requesterAgentId ?? null,
          taskId: input.taskId,
          worker: input.worker,
          workerAgentId: workerAgentResult[0]?.agentId ?? null,
        } satisfies AcceptanceRateIntentPayload,
        send: async () =>
          (
            await contractRateTask(
              input.taskId as `0x${string}`,
              payer as `0x${string}`,
              input.worker as `0x${string}`,
              input.rating,
              workerAgentId,
              raterAgentId,
              feedbackURI,
              feedbackHash,
              task.contractAddress
            )
          ).hash,
      });

      return { success: true, feedbackId };
    }),
});
