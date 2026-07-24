import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import {
  TaskCreateSchema,
  TaskListInputSchema,
  TaskListResponseSchema,
  TaskDetailResponseSchema,
  CancelTaskInputSchema,
  RefundExpiredInputSchema,
  RejectSubmissionInputSchema,
  UpdateTaskInputSchema,
  type TaskStatusType,
  type TaskModeType,
  type TaskVisibilityType,
  type TaskPhaseType,
  type SubmissionVisibilityType,
  type TaskAward,
  type AuctionTypeValue,
  estimateUsdBonusValue,
  estimateWorkerUsdBonusValue,
  estimateRequesterUsdBonusValue,
  estimateWorkerDreamsBonus,
  estimateRequesterDreamsBonus,
} from '@taskmarket/shared';
import { z } from 'zod';
import {
  tasks,
  taskAwards,
  submissions,
  proposals,
  agents,
  bids,
  taskDrops,
  taskDropTaskReservations,
} from '../db/schema';
import {
  eq,
  or,
  sql,
  desc,
  and,
  gt,
  gte,
  lt,
  lte,
  arrayOverlaps,
  asc,
  inArray,
  isNull,
  getTableColumns,
} from 'drizzle-orm';
import {
  contractCreateTask,
  contractAssignEvaluator,
  contractCancelTask,
  contractRefundExpired,
  contractUpdateTask,
  contractRejectSubmission,
  contractGetTaskHooks,
  contractGetDreamsPerUsdc,
  contractGetDreamsWorkerSplitBps,
  contractGetDreamsBonusBps,
  MODE_MAP,
  AUCTION_SUBTYPE_MAP,
  precomputeTaskId,
} from '../services/contract';
import { keccak256, toHex } from 'viem';
import { getServerConfig } from '../config/env';
import { computeClockPrice, computePriceTimestamp } from '../lib/auction';
import { lowerAddressEq } from '../lib/agents';
import { taskNotUnlisted } from '../lib/task-visibility';
import {
  computeNetReward,
  computePendingActions,
  computeSubmissionWindowOpen,
  computeTaskPhase,
  normalizeRequesterPublicKey,
} from '../lib/task';
import { canViewSubmission, type SubmissionVisibilityMode } from '../lib/submission-visibility';
import type { Context } from '../context';
import { notifyTaskDropSubscribers } from '../services/task-drops-email';
import { notifyNewTask } from '../services/task-notifications';
import { logger } from '../lib/logger';
import {
  releaseTaskDropReservation,
  reserveTaskDropForCreation,
  TaskDropReservationError,
} from '../services/task-drop-reservations';

// Tasks created before the ERC-8195 Rev007 submission-integrity upgrade (PR #135,
// merged 2026-06-30T18:15:06-04:00) predate the current escrow/refund flow. A wave of
// them are stuck open with expired escrow that can't be resolved on our side (no
// requester-reject path existed yet, refundExpired wasn't callable the way it is now).
// Hide them from discovery so agents stop finding tasks they can never win.
const REV007_LISTING_CUTOFF = new Date('2026-06-30T22:15:06.000Z');

const IN_REVIEW_TASK_STATUSES = ['review', 'appealing', 'disputed'] as const;
const SUBMISSION_WINDOW_TASK_STATUSES = ['open', 'claimed', 'worker_selected'] as const;
const RESOLVED_TASK_STATUSES = ['completed', 'cancelled', 'expired'] as const;

// Translates the derived `phase` filter (ADR-0024) into the equivalent status/expiry SQL
// condition -- `phase` is not a stored column, so filtering by it means expressing the
// same bucketing computeTaskPhase (lib/task.ts) applies in memory as a query predicate
// instead. Keep the two in lockstep; a task's phase must never differ between a filtered
// list result and its own computeTaskPhase value.
function taskPhaseCondition(phase: TaskPhaseType, now: Date) {
  switch (phase) {
    case 'in_review':
      return inArray(tasks.status, IN_REVIEW_TASK_STATUSES);
    case 'resolved':
      return inArray(tasks.status, RESOLVED_TASK_STATUSES);
    case 'awaiting_settlement':
      return and(
        inArray(tasks.status, SUBMISSION_WINDOW_TASK_STATUSES),
        lte(tasks.expiryTime, now)
      );
    case 'active':
    default:
      return or(
        and(inArray(tasks.status, SUBMISSION_WINDOW_TASK_STATUSES), gt(tasks.expiryTime, now)),
        eq(tasks.status, 'pending_approval')
      );
  }
}

/**
 * computePendingActions embeds the sole distinct active submitter's address
 * (only ever passed in when unambiguous -- see ADR-0027) in suggested command
 * strings (`accept --worker <addr>`, `reject-submission --worker <addr>`) --
 * but pendingActions is returned to every caller of `get`/`update` unfiltered,
 * so that address needs the same submissionVisibility gate as every other
 * reader of the `submissions` table (ADR-0016), not just an unconditional
 * reveal. `claimedBy` is a separate, already-public field (auction/claim/pitch
 * selection, not a submission), so it is deliberately not gated here.
 */
function visibleLatestSubmissionWorker(
  workerAddress: string | null | undefined,
  task: {
    requester: string;
    status: string;
    verdictType: string | null;
    submissionVisibility: string;
  },
  caller: Context['caller']
): string | null {
  if (!workerAddress) return null;
  const visible = canViewSubmission({
    mode: task.submissionVisibility as SubmissionVisibilityMode,
    taskStatus: task.status,
    taskVerdictType: task.verdictType,
    caller,
    task,
    submission: { workerAddress },
    winningAddresses: new Set<string>(),
  });
  return visible ? workerAddress : null;
}

export const tasksRouter = router({
  stats: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/stats',
        tags: ['Tasks'],
        summary: 'Get total task count and reward volume',
      },
    })
    .input(z.object({}))
    .output(z.object({ count: z.number(), totalRewards: z.string() }))
    .query(async ({ ctx }) => {
      const result = await ctx.db
        .select({
          count: sql<number>`count(*)::int`,
          totalRewards: sql<string>`coalesce(sum(${tasks.reward}::numeric), 0)::text`,
        })
        .from(tasks)
        .where(taskNotUnlisted);
      return {
        count: result[0]?.count ?? 0,
        totalRewards: result[0]?.totalRewards ?? '0',
      };
    }),

  create: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks',
        tags: ['Tasks'],
        summary: 'Create task (X402 required)',
      },
    })
    .input(TaskCreateSchema)
    .output(
      z.object({ success: z.boolean(), taskId: z.string(), taskDropId: z.string().nullable() })
    )
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Payment required: missing payer' });
      }
      const normalizedPayer = payer.toLowerCase();

      let resolvedTaskDropId: string | null = input.taskDropId ?? null;
      let inlineTaskDrop: {
        id: string;
        ownerAddress: string;
        name: string;
        description: string | null;
      } | null = null;

      if (input.taskDropCreate) {
        resolvedTaskDropId = `drop_${randomUUID()}`;
        inlineTaskDrop = {
          id: resolvedTaskDropId,
          ownerAddress: normalizedPayer,
          name: input.taskDropCreate.name,
          description: input.taskDropCreate.description ?? null,
        };
      }

      if (input.mode === 'auction') {
        if (!input.maxPrice) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'maxPrice is required for auction mode',
          });
        }
        if (!input.auctionType) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'auctionType is required for auction mode (dutch, english, reverse_dutch, reverse_english)',
          });
        }
        if (input.auctionType === 'reverse_dutch' && !input.auctionStartPrice) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'auctionStartPrice is required for reverse_dutch auction type',
          });
        }
        if (input.auctionType === 'dutch' && !input.auctionFloorPrice) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'auctionFloorPrice is required for dutch auction type',
          });
        }
      }

      const config = getServerConfig();
      const reward = BigInt(input.reward);
      const durationSecs = BigInt(Math.round(input.duration * 3600));
      const mode = MODE_MAP[input.mode ?? 'bounty'] ?? MODE_MAP['bounty']!;

      const pitchDeadlineSecs =
        input.mode === 'pitch'
          ? input.pitchDeadline
            ? BigInt(input.pitchDeadline)
            : durationSecs
          : BigInt(0);

      const bidDeadlineSecs =
        input.mode === 'auction'
          ? input.bidDeadline
            ? BigInt(input.bidDeadline * 3600)
            : durationSecs
          : BigInt(0);

      // Pre-compute the contract-generated task ID by reading requesterNonce from chain.
      // The contract generates: keccak256(abi.encode(chainId, address(this), requester, nonce))
      const taskId = await precomputeTaskId(payer as `0x${string}`, config.CONTRACT_ADDRESS);

      let taskDropReservationId: string | null = null;
      const existingTaskDropId = input.taskDropId;
      if (existingTaskDropId) {
        const preflightReservation = ctx.res.locals.taskDropReservation as
          | { id: string; taskDropId: string }
          | undefined;
        if (preflightReservation) {
          if (preflightReservation.taskDropId !== existingTaskDropId) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Task drop reservation does not match request',
            });
          }
          taskDropReservationId = preflightReservation.id;
        } else {
          taskDropReservationId = taskId;
          try {
            await reserveTaskDropForCreation({
              db: ctx.db,
              payer: normalizedPayer,
              reservationId: taskDropReservationId,
              taskDropId: existingTaskDropId,
            });
          } catch (error) {
            if (error instanceof TaskDropReservationError) {
              throw new TRPCError({ code: error.code, message: error.message });
            }
            throw error;
          }
        }
      }

      const auctionSubtype =
        input.mode === 'auction' && input.auctionType
          ? (AUCTION_SUBTYPE_MAP[input.auctionType] ?? ('0x00000000' as `0x${string}`))
          : ('0x00000000' as `0x${string}`);

      // Hash tags to bytes32 for on-chain storage.
      const hashedTags = (input.tags ?? []).map(
        (tag: string) => keccak256(toHex(tag)) as `0x${string}`
      );

      const hookContractAddr = (input.hookContract ??
        '0x0000000000000000000000000000000000000000') as `0x${string}`;
      const hookDataBytes = (input.hookData ?? '0x') as `0x${string}`;

      const paymentTxHash = ctx.res.locals.paymentTxHash as `0x${string}` | undefined;
      let escrowTxHash: `0x${string}`;
      try {
        escrowTxHash = await contractCreateTask(
          payer as `0x${string}`,
          reward,
          durationSecs,
          mode,
          pitchDeadlineSecs,
          bidDeadlineSecs,
          auctionSubtype,
          input.stakeRequired ?? false,
          input.stakeBps ?? 0,
          hookContractAddr,
          hashedTags,
          hookDataBytes,
          paymentTxHash
        );
      } catch (error) {
        if (taskDropReservationId) {
          try {
            await releaseTaskDropReservation({
              db: ctx.db,
              reservationId: taskDropReservationId,
            });
          } catch (cleanupError) {
            logger.error(
              `Failed to release task drop reservation ${taskDropReservationId}: ${
                cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
              }`
            );
          }
        }
        throw error;
      }

      const expiryTime = new Date(Date.now() + input.duration * 3600 * 1000);
      const taskVisibility = input.taskVisibility ?? 'public';
      const submissionVisibility = input.submissionVisibility ?? 'public';

      const requesterAgent = await ctx.db
        .select({ agentId: agents.agentId, publicKey: agents.publicKey })
        .from(agents)
        .where(lowerAddressEq(payer))
        .limit(1);

      const evaluatorAssignment: {
        evaluator: string;
        evaluatorFeeBps: number;
        evaluationWindow: number;
        appealWindow: number;
        disputeResolver: string | null;
      } | null = input.evaluator
        ? {
            evaluator: input.evaluator,
            evaluatorFeeBps: input.evaluatorFeeBps ?? 0,
            evaluationWindow: Math.round((input.evaluationWindowHours ?? 24) * 3600),
            appealWindow: Math.round((input.appealWindowHours ?? 24) * 3600),
            disputeResolver: input.disputeResolver ?? null,
          }
        : null;

      // Persist the drop/task rows atomically. Short, on-chain-free transaction.
      await ctx.db.transaction(async (tx) => {
        if (inlineTaskDrop) {
          await tx.insert(taskDrops).values(inlineTaskDrop);
        }

        await tx.insert(tasks).values({
          id: taskId,
          requester: payer,
          requesterPubkey: normalizeRequesterPublicKey(requesterAgent[0]?.publicKey, null) ?? '',
          description: input.description,
          reward: input.reward,
          escrowTxHash,
          expiryTime,
          status: 'open',
          tags: input.tags,
          mode: input.mode ?? 'bounty',
          taskVisibility,
          submissionVisibility,
          stakeRequired: input.stakeRequired ? 1 : 0,
          stakeBps: input.stakeBps ?? 0,
          pitchDeadline: input.pitchDeadline
            ? new Date(Date.now() + input.pitchDeadline * 1000)
            : null,
          bidDeadline: input.bidDeadline
            ? new Date(Date.now() + input.bidDeadline * 3600 * 1000)
            : null,
          maxPrice: input.maxPrice ?? null,
          auctionType: input.auctionType ?? null,
          auctionStartPrice: input.auctionStartPrice ?? null,
          auctionFloorPrice: input.auctionFloorPrice ?? null,
          metricDescription: input.metricDescription ?? null,
          metricTarget: input.metricTarget ?? null,
          platformFeeBps: config.DEFAULT_PLATFORM_FEE_BPS,
          requesterAgentId: requesterAgent[0]?.agentId ?? null,
          chainId: config.CHAIN_ID,
          contractAddress: config.CONTRACT_ADDRESS,
          hookContract: input.hookContract ?? null,
          taskDropId: resolvedTaskDropId,
        });

        if (taskDropReservationId) {
          await tx
            .delete(taskDropTaskReservations)
            .where(eq(taskDropTaskReservations.reservationId, taskDropReservationId));
        }
      });

      if (evaluatorAssignment) {
        await contractAssignEvaluator(
          taskId as `0x${string}`,
          payer as `0x${string}`,
          evaluatorAssignment.evaluator as `0x${string}`,
          0n,
          evaluatorAssignment.evaluatorFeeBps,
          evaluatorAssignment.evaluationWindow,
          evaluatorAssignment.appealWindow,
          (evaluatorAssignment.disputeResolver ??
            '0x0000000000000000000000000000000000000000') as `0x${string}`
        );
        await ctx.db.update(tasks).set(evaluatorAssignment).where(eq(tasks.id, taskId));
      }

      // Unlisted tasks opt out of Taskmarket's own discovery surfaces (ADR-0014) --
      // that includes outbound notifications, not just browse/search, since actively
      // emailing/pinging worker agents about an "unlisted" task would defeat the point.
      if (taskVisibility !== 'unlisted') {
        // Fire-and-forget targeted "new task" notification to eligible worker agents.
        // Runs AFTER the successful insert so a mailer hiccup can never fail or delay
        // task creation. Idempotent by taskId (embedded in the body); the daemon's
        // task poll remains the fallback if a send fails. Never awaited.
        void notifyNewTask({
          db: ctx.db,
          taskId,
          description: input.description,
          reward: input.reward,
          mode: input.mode ?? 'bounty',
          tags: input.tags,
        }).catch((err: unknown) => {
          logger.warn(
            `notifyNewTask failed for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`
          );
        });

        if (resolvedTaskDropId) {
          void notifyTaskDropSubscribers({
            db: ctx.db,
            taskDropId: resolvedTaskDropId,
            taskId,
            description: input.description,
            reward: input.reward,
            mode: input.mode ?? 'bounty',
            tags: input.tags,
          }).catch((err: unknown) => {
            logger.warn(
              `notifyTaskDropSubscribers failed for task ${taskId}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          });
        }
      }

      return { success: true, taskId, taskDropId: resolvedTaskDropId };
    }),

  list: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/tasks', tags: ['Tasks'], summary: 'List tasks' } })
    .input(TaskListInputSchema)
    .output(TaskListResponseSchema)
    .query(async ({ input, ctx }) => {
      const limit = input.limit || 20;
      const now = new Date();

      const conditions = [];
      // Discovery listings never surface unlisted tasks (ADR-0014). Fetching a
      // specific task by ID is unaffected -- this only gates the browse/search path.
      conditions.push(taskNotUnlisted);
      if (input.status && input.status !== 'ALL') {
        conditions.push(eq(tasks.status, input.status));
      }
      // Discovery listings (open, or unfiltered/ALL browsing) should never surface
      // pre-Rev007 legacy tasks or tasks whose escrow has already expired but whose
      // status hasn't transitioned yet (expiry only flips status via an on-chain
      // action, not automatically -- see refundExpired / indexer TaskExpired handler).
      // Non-open status filters (completed, cancelled, etc.) are left untouched so
      // historical records stay queryable.
      if (!input.status || input.status === 'ALL' || input.status === 'open') {
        conditions.push(gte(tasks.createdAt, REV007_LISTING_CUTOFF));
      }
      // 'open' isn't the only status with a submission window: 'claimed' (claim/auction
      // mode) and 'worker_selected' (pitch mode) are the equivalent "still taking
      // deliverables" states -- see computeSubmissionWindowOpen in lib/task.ts. Apply the
      // same expiry-exclusion guard to all three so filtering by any of them consistently
      // excludes tasks whose window has already closed, instead of only 'open' doing so.
      if (
        input.status === 'open' ||
        input.status === 'claimed' ||
        input.status === 'worker_selected'
      ) {
        conditions.push(gt(tasks.expiryTime, now));
      }
      if (input.phase) {
        conditions.push(taskPhaseCondition(input.phase, now));
      }
      if (input.mode && input.mode !== 'ALL') {
        conditions.push(eq(tasks.mode, input.mode));
      }
      if (input.auctionType) {
        conditions.push(eq(tasks.auctionType, input.auctionType));
      }
      if (input.requesterActorType) {
        if (input.requesterActorType === 'human') {
          conditions.push(
            sql`${tasks.requester} IN (SELECT ${agents.address} FROM ${agents} WHERE ${agents.registeredVia} = 'web')`
          );
        } else {
          // agent: registered via cli, OR not in agents table at all (matches display fallback)
          conditions.push(
            sql`(${tasks.requester} IN (SELECT ${agents.address} FROM ${agents} WHERE ${agents.registeredVia} = 'cli') OR ${tasks.requester} NOT IN (SELECT ${agents.address} FROM ${agents}))`
          );
        }
      }
      if (input.requester) {
        conditions.push(eq(tasks.requester, input.requester.toLowerCase()));
      }
      if (input.worker) {
        const workerLower = input.worker.toLowerCase();
        conditions.push(
          or(
            sql`lower(${tasks.claimedBy}) = ${workerLower}`,
            sql`exists (
              select 1 from ${taskAwards}
              where ${taskAwards.taskId} = ${tasks.id}
                and lower(${taskAwards.workerAddress}) = ${workerLower}
            )`
          )
        );
      }
      if (input.taskDropId) {
        conditions.push(eq(tasks.taskDropId, input.taskDropId));
      }
      if (input.tags && input.tags.length > 0) {
        conditions.push(arrayOverlaps(tasks.tags, input.tags));
      }
      if (input.minReward) {
        conditions.push(sql`${tasks.reward} >= ${input.minReward}`);
      }
      if (input.maxReward) {
        conditions.push(sql`${tasks.reward} <= ${input.maxReward}`);
      }
      if (input.deadlineHours) {
        const cutoff = new Date(Date.now() + input.deadlineHours * 3_600_000);
        conditions.push(gt(tasks.expiryTime, now));
        conditions.push(lte(tasks.expiryTime, cutoff));
      }
      // Cursor keyset pagination is keyed on createdAt and is only valid for the
      // default 'newest' ordering. Alternate sorts are single-page (the web listing
      // fetches one page without a cursor), so we skip the keyset filter for them.
      const sort = input.sort ?? 'newest';
      if (input.cursor && sort === 'newest') {
        conditions.push(lt(tasks.createdAt, new Date(input.cursor)));
      }

      // 'newest' (default) keeps the existing createdAt+cursor path. reward is a
      // numeric column, so ordering by it directly is numerically correct.
      let orderBy;
      switch (sort) {
        case 'reward_desc':
          orderBy = desc(tasks.reward);
          break;
        case 'reward_asc':
          orderBy = asc(tasks.reward);
          break;
        case 'deadline_asc':
          orderBy = asc(tasks.expiryTime);
          break;
        case 'newest':
        default:
          orderBy = desc(tasks.createdAt);
          break;
      }

      const results = await ctx.db
        .select({
          ...getTableColumns(tasks),
          awardCount: sql<number>`(
            select count(*)::int from ${taskAwards}
            where ${taskAwards.taskId} = "tasks"."id"
          )`,
          // rank-1 award, read-time projection over task_awards (not a stored
          // field, see ADR-0006) -- reuses the idx_task_awards_task_rank index
          // already backing the (taskId, rank) lookup, same cost class as the
          // awardCount subquery above.
          primaryAwardWorker: sql<string | null>`(
            select ${taskAwards.workerAddress} from ${taskAwards}
            where ${taskAwards.taskId} = "tasks"."id"
            order by ${taskAwards.rank} asc
            limit 1
          )`,
          primaryAwardRating: sql<number | null>`(
            select ${taskAwards.rating} from ${taskAwards}
            where ${taskAwards.taskId} = "tasks"."id"
            order by ${taskAwards.rank} asc
            limit 1
          )`,
        })
        .from(tasks)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderBy)
        .limit(limit + 1);

      const hasMore = results.length > limit;
      const tasksList = hasMore ? results.slice(0, limit) : results;

      // Batch all per-task counts in three queries instead of N*3 queries.
      const listIds = tasksList.map((t) => t.id);

      const requesterAddresses = Array.from(new Set(tasksList.map((t) => t.requester)));

      const [submissionCountRows, pitchCountRows, bidAggRows, requesterAgentRows] =
        await Promise.all([
          listIds.length > 0
            ? ctx.db
                .select({ taskId: submissions.taskId, count: sql<number>`count(*)::int` })
                .from(submissions)
                .where(and(inArray(submissions.taskId, listIds), isNull(submissions.rejectedAt)))
                .groupBy(submissions.taskId)
            : Promise.resolve([]),
          listIds.length > 0
            ? ctx.db
                .select({ taskId: proposals.taskId, count: sql<number>`count(*)::int` })
                .from(proposals)
                .where(inArray(proposals.taskId, listIds))
                .groupBy(proposals.taskId)
            : Promise.resolve([]),
          listIds.length > 0
            ? ctx.db
                .select({
                  taskId: bids.taskId,
                  count: sql<number>`count(*)::int`,
                  minPrice: sql<string | null>`min(${bids.price})`,
                })
                .from(bids)
                .where(inArray(bids.taskId, listIds))
                .groupBy(bids.taskId)
            : Promise.resolve([]),
          requesterAddresses.length > 0
            ? ctx.db
                .select({
                  address: agents.address,
                  registeredVia: agents.registeredVia,
                  publicKey: agents.publicKey,
                })
                .from(agents)
                .where(inArray(agents.address, requesterAddresses))
            : Promise.resolve([]),
        ]);

      const submissionCountMap = new Map(submissionCountRows.map((r) => [r.taskId, r.count]));
      const pitchCountMap = new Map(pitchCountRows.map((r) => [r.taskId, r.count]));
      const bidAggMap = new Map(bidAggRows.map((r) => [r.taskId, r]));
      const actorTypeByAddress = new Map<string, 'agent' | 'human'>(
        requesterAgentRows.map((r) => [
          r.address,
          r.registeredVia === 'web' ? ('human' as const) : ('agent' as const),
        ])
      );
      const requesterPublicKeyByAddress = new Map(
        requesterAgentRows.map((row) => [row.address, row.publicKey])
      );

      const tasksWithCounts = tasksList.map((task) => {
        let auctionBidCount: number | null = null;
        let currentAuctionPrice: string | null = null;
        let currentLowestBid: string | null = null;

        if (task.mode === 'auction') {
          const agg = bidAggMap.get(task.id);
          auctionBidCount = agg ? Number(agg.count) : 0;

          if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
            const price = computeClockPrice(task, now);
            currentAuctionPrice = price !== null ? price.toString() : null;
          }

          if (task.auctionType === 'english') {
            currentLowestBid = bidAggMap.get(task.id)?.minPrice ?? null;
          }
        }

        const grossPayout =
          task.mode === 'auction'
            ? task.claimedBy
              ? (bidAggMap.get(task.id)?.minPrice ?? null)
              : null
            : task.reward;

        return {
          id: task.id,
          requester: task.requester,
          requesterPubkey: normalizeRequesterPublicKey(
            requesterPublicKeyByAddress.get(task.requester),
            task.requesterPubkey
          ),
          description: task.description,
          reward: task.reward,
          escrowTxHash: task.escrowTxHash,
          createdAt: task.createdAt.toISOString(),
          expiryTime: task.expiryTime.toISOString(),
          status: task.status as TaskStatusType,
          tags: task.tags,
          primaryAward: task.primaryAwardWorker
            ? { workerAddress: task.primaryAwardWorker, rating: task.primaryAwardRating }
            : null,
          mode: task.mode as TaskModeType,
          taskVisibility: task.taskVisibility as TaskVisibilityType,
          submissionVisibility: task.submissionVisibility as SubmissionVisibilityType,
          stakeRequired: task.stakeRequired === 1,
          stakeBps: task.stakeBps,
          pitchDeadline: task.pitchDeadline?.toISOString() || null,
          bidDeadline: task.bidDeadline?.toISOString() || null,
          maxPrice: task.maxPrice ?? null,
          metricDescription: task.metricDescription,
          metricTarget: task.metricTarget,
          claimedBy: task.claimedBy,
          claimedAt: task.claimedAt?.toISOString() || null,
          platformFeeBps: task.platformFeeBps,
          submissionCount: Number(submissionCountMap.get(task.id) ?? 0),
          awardCount: Number(task.awardCount ?? 0),
          pitchCount: Number(pitchCountMap.get(task.id) ?? 0),
          requesterAgentId: task.requesterAgentId ?? null,
          requesterActorType: actorTypeByAddress.get(task.requester) ?? 'agent',
          auctionType: (task.auctionType as AuctionTypeValue | null) ?? null,
          auctionStartPrice: task.auctionStartPrice ?? null,
          auctionFloorPrice: task.auctionFloorPrice ?? null,
          currentAuctionPrice,
          auctionBidCount,
          currentLowestBid,
          submissionWindowOpen: computeSubmissionWindowOpen(task, now),
          phase: computeTaskPhase(task, now),
          netReward: computeNetReward(grossPayout, task.platformFeeBps ?? 0),
          taskDropId: task.taskDropId ?? null,
        };
      });

      return {
        tasks: tasksWithCounts,
        nextCursor: hasMore ? tasksList[tasksList.length - 1].createdAt.toISOString() : null,
        hasMore,
      };
    }),

  get: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}',
        tags: ['Tasks'],
        summary: 'Get task by ID',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(TaskDetailResponseSchema.nullable())
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);

      if (result.length === 0) {
        return null;
      }

      const task = result[0];
      const now = new Date();

      const workerAddress = task.claimedBy;
      const dreamsHookAddress = getServerConfig().DREAMS_HOOK_ADDRESS;
      const dreamsHookConfigured = Boolean(dreamsHookAddress);
      const [
        submissionCount,
        pitchCount,
        workerAgent,
        requesterAgentRow,
        taskHooks,
        dreamsPerUsdc,
        dreamsWorkerSplitBps,
        dreamsBonusBps,
        awardRows,
      ] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(submissions)
          .where(and(eq(submissions.taskId, task.id), isNull(submissions.rejectedAt))),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(proposals)
          .where(eq(proposals.taskId, task.id)),
        workerAddress
          ? ctx.db
              .select({ agentId: agents.agentId, registeredVia: agents.registeredVia })
              .from(agents)
              .where(sql`lower(${agents.address}) = lower(${workerAddress})`)
              .limit(1)
          : Promise.resolve([]),
        ctx.db
          .select({ registeredVia: agents.registeredVia, publicKey: agents.publicKey })
          .from(agents)
          .where(sql`lower(${agents.address}) = lower(${task.requester})`)
          .limit(1),
        contractGetTaskHooks(task.id as `0x${string}`, task.contractAddress).catch(() => []),
        dreamsHookConfigured ? contractGetDreamsPerUsdc().catch(() => 0n) : Promise.resolve(0n),
        dreamsHookConfigured
          ? contractGetDreamsWorkerSplitBps().catch(() => 0)
          : Promise.resolve(0),
        dreamsHookConfigured ? contractGetDreamsBonusBps().catch(() => 0) : Promise.resolve(0),
        ctx.db
          .select({
            workerAddress: taskAwards.workerAddress,
            // A leftJoin on lower(agents.address) = lower(worker_address) fans out to one
            // row per matching agents row -- agents.address has no case-insensitive
            // uniqueness constraint, so a legacy mixed-case row and a lowercase row for the
            // same real address both match and double the award. Correlated scalar
            // subqueries return exactly one row per award regardless of how many agents
            // rows exist for that address, preferring the one that completed identity
            // registration (agent_id set) if there's a choice.
            workerAgentId: sql<string | null>`(
              select ${agents.agentId} from ${agents}
              where lower(${agents.address}) = lower(${taskAwards.workerAddress})
              order by ${agents.agentId} is not null desc
              limit 1
            )`,
            workerRegisteredVia: sql<string | null>`(
              select ${agents.registeredVia} from ${agents}
              where lower(${agents.address}) = lower(${taskAwards.workerAddress})
              order by ${agents.agentId} is not null desc
              limit 1
            )`,
            rank: taskAwards.rank,
            workerPayment: taskAwards.workerPayment,
            platformFee: taskAwards.platformFee,
            settlementTxHash: taskAwards.settlementTxHash,
            settledAt: taskAwards.settledAt,
            rating: taskAwards.rating,
          })
          .from(taskAwards)
          .where(eq(taskAwards.taskId, task.id))
          .orderBy(asc(taskAwards.rank), asc(taskAwards.logIndex)),
      ]);

      const awards: TaskAward[] = awardRows.map((award) => {
        // rank 1 is the primary winner -- read-time projection over task_awards,
        // not a separately stored/written field, so there is nothing to drift
        // out of sync with (see ADR-0006).
        const isPrimary = award.rank === 1;

        return {
          workerAddress: award.workerAddress,
          workerAgentId: award.workerAgentId ?? null,
          workerActorType: award.workerRegisteredVia === 'web' ? 'human' : 'agent',
          rank: award.rank,
          isPrimary,
          grossAmount: (BigInt(award.workerPayment) + BigInt(award.platformFee)).toString(),
          workerPayment: award.workerPayment,
          platformFee: award.platformFee,
          settlementTxHash: award.settlementTxHash,
          settledAt: award.settledAt.toISOString(),
          rating: award.rating,
        };
      });

      // Resolve the submitter to pre-fill into the requester's accept command, but
      // only when there is exactly one distinct active submitter -- suggesting
      // "whoever submitted most recently" is gameable by free, unlimited
      // resubmission (see ADR-0027). Bounty/Benchmark stay `open` while collecting
      // submissions, so check there too (not just pending_approval) whenever
      // submissions exist.
      const hasSubmissions = Number(submissionCount[0]?.count ?? 0) > 0;
      const distinctSubmitters =
        hasSubmissions &&
        (task.status === 'pending_approval' || task.mode === 'bounty' || task.mode === 'benchmark')
          ? await ctx.db
              .select({ workerAddress: submissions.workerAddress })
              .from(submissions)
              .where(and(eq(submissions.taskId, task.id), isNull(submissions.rejectedAt)))
              .groupBy(submissions.workerAddress)
              .limit(2)
          : [];
      const latestSubmission = distinctSubmitters.length === 1 ? distinctSubmitters : [];
      const requesterActorType: 'agent' | 'human' =
        requesterAgentRow[0]?.registeredVia === 'web' ? 'human' : 'agent';
      const workerActorType: 'agent' | 'human' | undefined = workerAddress
        ? workerAgent[0]?.registeredVia === 'web'
          ? 'human'
          : 'agent'
        : undefined;

      // Auction-specific computed fields
      let auctionBidCount: number | null = null;
      let currentAuctionPrice: string | null = null;
      let auctionPriceReachesFloorAt: string | null = null;
      let auctionPriceReachesMaxAt: string | null = null;
      let currentLowestBid: string | null = null;
      let auctionWinningPrice: string | null = null;

      if (task.mode === 'auction') {
        const bidCountResult = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bids)
          .where(eq(bids.taskId, task.id));
        auctionBidCount = Number(bidCountResult[0]?.count ?? 0);

        if (task.claimedBy) {
          const winningBid = await ctx.db
            .select({ price: bids.price })
            .from(bids)
            .where(and(eq(bids.taskId, task.id), eq(bids.workerAddress, task.claimedBy)))
            .orderBy(desc(bids.createdAt))
            .limit(1);
          auctionWinningPrice = winningBid[0]?.price ?? null;
        }

        if (task.auctionType === 'dutch') {
          const price = computeClockPrice(task, now);
          currentAuctionPrice = price !== null ? price.toString() : null;
          const floorPrice = task.auctionFloorPrice ? BigInt(task.auctionFloorPrice) : 0n;
          auctionPriceReachesFloorAt = computePriceTimestamp(task, floorPrice);
        } else if (task.auctionType === 'reverse_dutch') {
          const price = computeClockPrice(task, now);
          currentAuctionPrice = price !== null ? price.toString() : null;
          const maxPrice = task.maxPrice ? BigInt(task.maxPrice) : 0n;
          auctionPriceReachesMaxAt = computePriceTimestamp(task, maxPrice);
        } else if (task.auctionType === 'english') {
          const lowestBid = await ctx.db
            .select()
            .from(bids)
            .where(eq(bids.taskId, task.id))
            .orderBy(asc(bids.price))
            .limit(1);
          currentLowestBid = lowestBid[0]?.price ?? null;
        }
      }

      const pitchCountNum = Number(pitchCount[0]?.count || 0);
      const clockPrice =
        task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch'
          ? currentAuctionPrice !== null
            ? BigInt(currentAuctionPrice)
            : null
          : null;

      const submissionWindowOpen = computeSubmissionWindowOpen(task, now);
      const phase = computeTaskPhase(task, now);
      const taskDrop =
        task.taskDropId !== null && task.taskDropId !== undefined
          ? ((
              await ctx.db
                .select({ id: taskDrops.id, name: taskDrops.name })
                .from(taskDrops)
                .where(eq(taskDrops.id, task.taskDropId))
                .limit(1)
            )[0] ?? null)
          : null;

      const hooksList: string[] =
        taskHooks.length > 0 ? [...taskHooks] : task.hookContract ? [task.hookContract] : [];
      const hasDreamsHook =
        dreamsHookAddress !== undefined &&
        hooksList.some((h) => h.toLowerCase() === dreamsHookAddress.toLowerCase());
      const dreamsPerUsdcField =
        hasDreamsHook && dreamsPerUsdc > 0n && dreamsBonusBps > 0
          ? dreamsPerUsdc.toString()
          : undefined;
      const bonusBpsField = dreamsPerUsdcField !== undefined ? dreamsBonusBps : undefined;
      const estimatedUsdBonusValueField =
        dreamsPerUsdcField !== undefined
          ? estimateUsdBonusValue(task.reward, dreamsBonusBps)
          : undefined;
      const estimatedWorkerUsdBonusValueField =
        dreamsPerUsdcField !== undefined
          ? estimateWorkerUsdBonusValue(task.reward, dreamsBonusBps, dreamsWorkerSplitBps)
          : undefined;
      const estimatedRequesterUsdBonusValueField =
        dreamsPerUsdcField !== undefined
          ? estimateRequesterUsdBonusValue(task.reward, dreamsBonusBps, dreamsWorkerSplitBps)
          : undefined;
      const estimatedWorkerDreamsBonusField =
        dreamsPerUsdcField !== undefined
          ? estimateWorkerDreamsBonus(
              task.reward,
              dreamsPerUsdcField,
              dreamsBonusBps,
              dreamsWorkerSplitBps
            )
          : undefined;
      const estimatedRequesterDreamsBonusField =
        dreamsPerUsdcField !== undefined
          ? estimateRequesterDreamsBonus(
              task.reward,
              dreamsPerUsdcField,
              dreamsBonusBps,
              dreamsWorkerSplitBps
            )
          : undefined;

      return {
        id: task.id,
        requester: task.requester,
        requesterPubkey: normalizeRequesterPublicKey(
          requesterAgentRow[0]?.publicKey,
          task.requesterPubkey
        ),
        description: task.description,
        reward: task.reward,
        escrowTxHash: task.escrowTxHash,
        createdAt: task.createdAt.toISOString(),
        expiryTime: task.expiryTime.toISOString(),
        status: task.status as TaskStatusType,
        tags: task.tags,
        primaryAward: (() => {
          const primary = awards.find((award) => award.isPrimary);
          return primary ? { workerAddress: primary.workerAddress, rating: primary.rating } : null;
        })(),
        mode: task.mode as TaskModeType,
        taskVisibility: task.taskVisibility as TaskVisibilityType,
        submissionVisibility: task.submissionVisibility as SubmissionVisibilityType,
        stakeRequired: task.stakeRequired === 1,
        stakeBps: task.stakeBps,
        pitchDeadline: task.pitchDeadline?.toISOString() || null,
        bidDeadline: task.bidDeadline?.toISOString() || null,
        maxPrice: task.maxPrice ?? null,
        metricDescription: task.metricDescription,
        metricTarget: task.metricTarget,
        claimedBy: task.claimedBy,
        claimedAt: task.claimedAt?.toISOString() || null,
        platformFeeBps: task.platformFeeBps,
        submissionCount: Number(submissionCount[0]?.count || 0),
        awardCount: awards.length,
        pitchCount: pitchCountNum,
        requesterAgentId: task.requesterAgentId ?? null,
        requesterActorType,
        workerAgentId: workerAgent[0]?.agentId ?? null,
        workerActorType,
        auctionType: (task.auctionType as AuctionTypeValue | null) ?? null,
        auctionStartPrice: task.auctionStartPrice ?? null,
        auctionFloorPrice: task.auctionFloorPrice ?? null,
        currentAuctionPrice,
        auctionBidCount,
        auctionPriceReachesFloorAt,
        auctionPriceReachesMaxAt,
        currentLowestBid,
        hookContract: task.hookContract ?? null,
        evaluator: task.evaluator ?? null,
        evaluatorStake: task.evaluatorStake ?? null,
        evaluatorFeeBps: task.evaluatorFeeBps ?? null,
        evaluationWindow: task.evaluationWindow ?? null,
        appealWindow: task.appealWindow ?? null,
        disputeResolver: task.disputeResolver ?? null,
        appealDeadline: task.appealDeadline?.toISOString() ?? null,
        evaluatorDeadline: task.evaluatorDeadline?.toISOString() ?? null,
        verdictType: (task.verdictType as 'APPROVE' | 'REJECT' | 'PARTIAL' | null) ?? null,
        verdictScore: task.verdictScore ?? null,
        verdictConfidence: task.verdictConfidence ?? null,
        verdictEvidenceHash: task.verdictEvidenceHash ?? null,
        selfAward: task.selfAward ?? null,
        taskDropId: task.taskDropId ?? null,
        taskDrop,
        hooks: hooksList,
        dreamsPerUsdc: dreamsPerUsdcField,
        bonusBps: bonusBpsField,
        estimatedUsdBonusValue: estimatedUsdBonusValueField,
        estimatedWorkerUsdBonusValue: estimatedWorkerUsdBonusValueField,
        estimatedRequesterUsdBonusValue: estimatedRequesterUsdBonusValueField,
        estimatedWorkerDreamsBonus: estimatedWorkerDreamsBonusField,
        estimatedRequesterDreamsBonus: estimatedRequesterDreamsBonusField,
        submissionWindowOpen,
        phase,
        netReward: computeNetReward(
          task.mode === 'auction'
            ? task.status === 'open'
              ? null
              : auctionWinningPrice
            : task.reward,
          task.platformFeeBps ?? 0
        ),
        pendingActions: computePendingActions(
          {
            id: task.id,
            requester: task.requester,
            status: task.status,
            mode: task.mode,
            pitchCount: pitchCountNum,
            bidCount: auctionBidCount ?? 0,
            submissionCount: Number(submissionCount[0]?.count || 0),
            expiryTime: task.expiryTime,
            pitchDeadline: task.pitchDeadline,
            bidDeadline: task.bidDeadline,
            claimedBy: task.claimedBy,
            auctionType: task.auctionType,
            currentClockPrice: clockPrice,
            currentLowestBid,
            latestSubmissionWorker: visibleLatestSubmissionWorker(
              latestSubmission[0]?.workerAddress,
              task,
              ctx.caller
            ),
            evaluator: task.evaluator,
            disputeResolver: task.disputeResolver,
            evaluatorDeadline: task.evaluatorDeadline,
            appealDeadline: task.appealDeadline,
            awardWorkers: awards.map((award) => ({
              workerAddress: award.workerAddress,
              rating: award.rating,
            })),
          },
          now
        ),
        awards,
      };
    }),

  cancel: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/cancel',
        tags: ['Tasks'],
        summary: 'Cancel an open task (X402 required)',
      },
    })
    .input(CancelTaskInputSchema)
    .output(z.object({ txHash: z.string() }))
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
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the task requester can cancel' });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not open' });
      }

      if (task.mode === 'auction') {
        const bidCount = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bids)
          .where(eq(bids.taskId, input.taskId));
        if (Number(bidCount[0]?.count ?? 0) > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Bids exist — cannot cancel auction with bids',
          });
        }
      }

      if (task.mode === 'bounty' || task.mode === 'benchmark') {
        const submissionCount = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(submissions)
          .where(and(eq(submissions.taskId, input.taskId), isNull(submissions.rejectedAt)));
        if (Number(submissionCount[0]?.count ?? 0) > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Active submissions exist — reject them or accept a winner before cancelling',
          });
        }
      }

      const txHash = await contractCancelTask(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        task.requesterAgentId ? BigInt(task.requesterAgentId) : 0n,
        task.contractAddress
      );

      await ctx.db
        .update(tasks)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(tasks.id, input.taskId));

      return { txHash };
    }),

  refundExpired: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/refund-expired',
        tags: ['Tasks'],
        summary:
          'Refund an expired task with no submissions back to the requester (X402 required, callable by anyone)',
      },
    })
    .input(RefundExpiredInputSchema)
    .output(z.object({ txHash: z.string() }))
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

      if (task.status === 'expired') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is already expired' });
      }
      if (task.status === 'completed' || task.status === 'cancelled') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Task is already ${task.status}` });
      }
      if (new Date() < task.expiryTime) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task has not yet expired' });
      }

      if (task.mode === 'bounty' || task.mode === 'benchmark') {
        const subCount = await ctx.db
          .select({ count: sql<string>`count(*)` })
          .from(submissions)
          .where(and(eq(submissions.taskId, input.taskId), isNull(submissions.rejectedAt)));

        if (Number(subCount[0]?.count ?? 0) > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Task has active submissions — use accept or reject before refund',
          });
        }
      }

      const txHash = await contractRefundExpired(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        task.requesterAgentId ? BigInt(task.requesterAgentId) : 0n
      );

      try {
        await ctx.db.update(tasks).set({ status: 'expired' }).where(eq(tasks.id, input.taskId));
      } catch {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Refund sent on-chain (${txHash}) but DB sync failed — contact support with this tx hash`,
        });
      }

      return { txHash };
    }),

  update: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/update',
        tags: ['Tasks'],
        summary: 'Update an open task (X402 required)',
      },
    })
    .input(UpdateTaskInputSchema)
    .output(TaskDetailResponseSchema.nullable())
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
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the task requester can update' });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not open' });
      }

      if (task.mode === 'auction') {
        const bidCount = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bids)
          .where(eq(bids.taskId, input.taskId));
        if (Number(bidCount[0]?.count ?? 0) > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Bids exist — cannot update auction with bids',
          });
        }
      }

      const effectiveReward = input.reward ?? task.reward;
      const effectiveFloorPrice = input.auctionFloorPrice ?? task.auctionFloorPrice;
      const effectiveStartPrice = input.auctionStartPrice ?? task.auctionStartPrice;
      if (effectiveFloorPrice != null && BigInt(effectiveFloorPrice) > BigInt(effectiveReward)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'auctionFloorPrice must be <= reward',
        });
      }
      if (effectiveStartPrice != null && BigInt(effectiveStartPrice) > BigInt(effectiveReward)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'auctionStartPrice must be <= reward',
        });
      }

      const newReward = input.reward ? BigInt(input.reward) : 0n;
      const newExpiryTime = input.expiryTime ? BigInt(input.expiryTime) : 0n;
      const newBidDeadline = input.bidDeadline ? BigInt(input.bidDeadline) : 0n;
      const newPitchDeadline = input.pitchDeadline ? BigInt(input.pitchDeadline) : 0n;

      const hasOnChainChange =
        (newReward !== 0n && newReward !== BigInt(task.reward)) ||
        newExpiryTime !== 0n ||
        newBidDeadline !== 0n ||
        newPitchDeadline !== 0n;

      if (hasOnChainChange) {
        await contractUpdateTask(
          input.taskId as `0x${string}`,
          payer as `0x${string}`,
          newReward,
          newExpiryTime,
          newBidDeadline,
          newPitchDeadline,
          BigInt(task.reward),
          task.contractAddress
        );
      }

      const dbUpdate: Record<string, unknown> = {};
      if (input.reward && input.reward !== task.reward) {
        dbUpdate.reward = input.reward;
        if (task.mode === 'auction') {
          dbUpdate.maxPrice = input.reward;
        }
      }
      if (input.expiryTime) {
        dbUpdate.expiryTime = new Date(input.expiryTime * 1000);
      }
      if (input.bidDeadline) {
        dbUpdate.bidDeadline = new Date(input.bidDeadline * 1000);
      }
      if (input.pitchDeadline) {
        dbUpdate.pitchDeadline = new Date(input.pitchDeadline * 1000);
      }
      if (input.auctionFloorPrice !== undefined) {
        dbUpdate.auctionFloorPrice = input.auctionFloorPrice;
      }
      if (input.auctionStartPrice !== undefined) {
        dbUpdate.auctionStartPrice = input.auctionStartPrice;
      }
      if (input.description !== undefined) {
        dbUpdate.description = input.description;
      }
      if (input.tags !== undefined) {
        dbUpdate.tags = input.tags;
      }
      if (input.metricDescription !== undefined) {
        dbUpdate.metricDescription = input.metricDescription;
      }

      if (Object.keys(dbUpdate).length > 0) {
        await ctx.db.update(tasks).set(dbUpdate).where(eq(tasks.id, input.taskId));
      }

      // Return updated task
      const updated = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      if (updated.length === 0) return null;
      const t = updated[0];

      const updateNow = new Date();

      const bidCountResult =
        t.mode === 'auction'
          ? await ctx.db
              .select({ count: sql<number>`count(*)::int` })
              .from(bids)
              .where(eq(bids.taskId, t.id))
          : null;
      const auctionBidCount = bidCountResult ? Number(bidCountResult[0]?.count ?? 0) : null;

      let updateCurrentAuctionPrice: string | null = null;
      let updateAuctionPriceReachesFloorAt: string | null = null;
      let updateAuctionPriceReachesMaxAt: string | null = null;
      let updateCurrentLowestBid: string | null = null;

      if (t.mode === 'auction') {
        if (t.auctionType === 'dutch') {
          const price = computeClockPrice(t, updateNow);
          updateCurrentAuctionPrice = price !== null ? price.toString() : null;
          const floorPrice = t.auctionFloorPrice ? BigInt(t.auctionFloorPrice) : 0n;
          updateAuctionPriceReachesFloorAt = computePriceTimestamp(t, floorPrice);
        } else if (t.auctionType === 'reverse_dutch') {
          const price = computeClockPrice(t, updateNow);
          updateCurrentAuctionPrice = price !== null ? price.toString() : null;
          const maxPriceBig = t.maxPrice ? BigInt(t.maxPrice) : 0n;
          updateAuctionPriceReachesMaxAt = computePriceTimestamp(t, maxPriceBig);
        } else if (t.auctionType === 'english') {
          const lowestBid = await ctx.db
            .select()
            .from(bids)
            .where(eq(bids.taskId, t.id))
            .orderBy(asc(bids.price))
            .limit(1);
          updateCurrentLowestBid = lowestBid[0]?.price ?? null;
        }
      }

      const [updatedSubmissionCount, updatedPitchCount, updatedRequesterAgent] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(submissions)
          .where(and(eq(submissions.taskId, t.id), isNull(submissions.rejectedAt))),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(proposals)
          .where(eq(proposals.taskId, t.id)),
        ctx.db
          .select({ publicKey: agents.publicKey })
          .from(agents)
          .where(lowerAddressEq(t.requester))
          .limit(1),
      ]);

      const updateSubmissionWindowOpen = computeSubmissionWindowOpen(t, updateNow);
      const updatePhase = computeTaskPhase(t, updateNow);

      // Only pre-fill a suggested worker when there is exactly one distinct active
      // submitter -- see ADR-0027 (gameable by free, unlimited resubmission otherwise).
      const hasUpdatedSubmissions = Number(updatedSubmissionCount[0]?.count ?? 0) > 0;
      const updatedDistinctSubmitters =
        hasUpdatedSubmissions && (t.mode === 'bounty' || t.mode === 'benchmark')
          ? await ctx.db
              .select({ workerAddress: submissions.workerAddress })
              .from(submissions)
              .where(and(eq(submissions.taskId, t.id), isNull(submissions.rejectedAt)))
              .groupBy(submissions.workerAddress)
              .limit(2)
          : [];
      const updatedLatestSubmission =
        updatedDistinctSubmitters.length === 1 ? updatedDistinctSubmitters : [];

      return {
        id: t.id,
        requester: t.requester,
        requesterPubkey: normalizeRequesterPublicKey(
          updatedRequesterAgent[0]?.publicKey,
          t.requesterPubkey
        ),
        description: t.description,
        reward: t.reward,
        escrowTxHash: t.escrowTxHash,
        createdAt: t.createdAt.toISOString(),
        expiryTime: t.expiryTime.toISOString(),
        status: t.status as TaskStatusType,
        tags: t.tags,
        // Same open-only invariant as awardWorkers/awards below -- no awards
        // can exist yet for a task update is allowed to run against.
        primaryAward: null,
        mode: t.mode as TaskModeType,
        taskVisibility: t.taskVisibility as TaskVisibilityType,
        submissionVisibility: t.submissionVisibility as SubmissionVisibilityType,
        stakeRequired: t.stakeRequired === 1,
        stakeBps: t.stakeBps,
        pitchDeadline: t.pitchDeadline?.toISOString() || null,
        bidDeadline: t.bidDeadline?.toISOString() || null,
        maxPrice: t.maxPrice ?? null,
        metricDescription: t.metricDescription,
        metricTarget: t.metricTarget,
        claimedBy: t.claimedBy,
        claimedAt: t.claimedAt?.toISOString() || null,
        platformFeeBps: t.platformFeeBps,
        submissionCount: Number(updatedSubmissionCount[0]?.count || 0),
        // update only ever runs against status === 'open' tasks (guarded
        // above), so no task_awards rows can exist yet -- 0 is always correct.
        awardCount: 0,
        pitchCount: Number(updatedPitchCount[0]?.count || 0),
        requesterAgentId: t.requesterAgentId ?? null,
        auctionType: (t.auctionType as AuctionTypeValue | null) ?? null,
        auctionStartPrice: t.auctionStartPrice ?? null,
        auctionFloorPrice: t.auctionFloorPrice ?? null,
        currentAuctionPrice: updateCurrentAuctionPrice,
        auctionBidCount,
        auctionPriceReachesFloorAt: updateAuctionPriceReachesFloorAt,
        auctionPriceReachesMaxAt: updateAuctionPriceReachesMaxAt,
        currentLowestBid: updateCurrentLowestBid,
        submissionWindowOpen: updateSubmissionWindowOpen,
        phase: updatePhase,
        netReward: computeNetReward(t.mode === 'auction' ? null : t.reward, t.platformFeeBps ?? 0),
        pendingActions: computePendingActions(
          {
            id: t.id,
            requester: t.requester,
            status: t.status,
            mode: t.mode,
            pitchCount: Number(updatedPitchCount[0]?.count || 0),
            bidCount: auctionBidCount ?? 0,
            submissionCount: Number(updatedSubmissionCount[0]?.count || 0),
            expiryTime: t.expiryTime,
            pitchDeadline: t.pitchDeadline,
            bidDeadline: t.bidDeadline,
            claimedBy: t.claimedBy,
            auctionType: t.auctionType,
            currentClockPrice:
              updateCurrentAuctionPrice !== null ? BigInt(updateCurrentAuctionPrice) : null,
            currentLowestBid: updateCurrentLowestBid,
            latestSubmissionWorker: visibleLatestSubmissionWorker(
              updatedLatestSubmission[0]?.workerAddress,
              t,
              ctx.caller
            ),
            evaluator: t.evaluator,
            disputeResolver: t.disputeResolver,
            evaluatorDeadline: t.evaluatorDeadline,
            appealDeadline: t.appealDeadline,
            // update only ever runs against status === 'open' tasks (guarded
            // above), and no task has task_awards rows pre-completion, so an
            // empty array here is always correct, not an approximation.
            awardWorkers: [],
          },
          updateNow
        ),
        // Same open-only invariant as awardWorkers above -- no awards can exist yet.
        awards: [],
      };
    }),

  rejectSubmission: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/reject-submission',
        tags: ['Tasks'],
        summary: 'Reject a worker submission on a bounty or benchmark task (X402 required)',
      },
    })
    .input(RejectSubmissionInputSchema)
    .output(z.object({ txHash: z.string() }))
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

      if (task.mode !== 'bounty' && task.mode !== 'benchmark') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'rejectSubmission is only valid for bounty or benchmark tasks',
        });
      }

      if (task.status !== 'open' && task.status !== 'pending_approval') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Task must be open or pending_approval to reject a submission',
        });
      }

      if (task.requester.toLowerCase() !== payer.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the task requester can reject submissions',
        });
      }

      const workerSubmission = await ctx.db
        .select()
        .from(submissions)
        .where(
          and(eq(submissions.taskId, input.taskId), eq(submissions.workerAddress, input.worker))
        )
        .limit(1);

      if (workerSubmission.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No submission found for this worker on this task',
        });
      }

      const txHash = await contractRejectSubmission(
        input.taskId as `0x${string}`,
        input.worker as `0x${string}`,
        payer as `0x${string}`
      );

      await ctx.db
        .update(submissions)
        .set({ rejectedAt: new Date() })
        .where(
          and(eq(submissions.taskId, input.taskId), eq(submissions.workerAddress, input.worker))
        );

      return { txHash };
    }),
});
