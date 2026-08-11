// Implements: ADR-0055
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import {
  AssignEvaluatorInputSchema,
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
import { tasks, taskAwards, submissions, proposals, agents, bids, taskDrops } from '../db/schema';
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
  contractCancelTask,
  contractRejectSubmission,
  contractGetTaskHooks,
  contractGetDreamsPerUsdc,
  contractGetDreamsWorkerSplitBps,
  contractGetDreamsBonusBps,
  taskIdForTx,
} from '../services/contract';
import { getServerConfig } from '../config/env';
import { computeClockPrice, computePriceTimestamp } from '../lib/auction';
import { lowerAddressEq } from '../lib/agents';
import { taskDiscoverable, canView, fetchPrivateViewabilityContext } from '../lib/task-visibility';
import {
  computeNetReward,
  computePendingActions,
  computeSubmissionWindowOpen,
  computeTaskPhase,
  normalizeRequesterPublicKey,
} from '../lib/task';
import { canViewSubmission, type SubmissionVisibilityMode } from '../lib/submission-visibility';
import type { Context } from '../context';
import { logger } from '../lib/logger';
import {
  releaseTaskDropReservation,
  reserveTaskDropForCreation,
  TaskDropReservationError,
} from '../services/task-drop-reservations';
import { resolveAppealAuthorization } from '../services/task-appeal-authorization';
import {
  assertEvaluatorAssignable,
  buildEvaluatorAssignment,
  EvaluatorAssignmentError,
  sendEvaluatorAssignment,
  type TasksAssignEvaluatorIntentPayload,
} from '../services/evaluator-assignment';
import { settledPaymentReference } from '../middleware/x402';
import { runRelayedIntent } from '../services/relayed-intent-request';
import { registerRelayedIntentHandlers } from '../services/intents/register';
import { RELAYED_WRITE_REQUEST_HEADERS } from '../lib/openapi-headers';
import { hashTaskAccessPasswordWithDerivedSalt } from '../lib/task-access-password';
import {
  broadcastTasksCreate,
  toTasksCreateInput,
  type TasksCreateIntentPayload,
} from '../services/intents/tasks-create-intent';
import {
  broadcastTasksRefundExpired,
  broadcastTasksUpdate,
  type TasksCancelIntentPayload,
  type TasksRefundExpiredIntentPayload,
  type TasksRejectSubmissionIntentPayload,
  type TasksUpdateIntentPayload,
} from '../services/intents/tasks-mutation-intents';

// Registration is idempotent, and the completion handlers must exist before the first request
// reaches create() -- not merely by the time the reconciler runs. Asking for it here rather
// than relying on startup ordering keeps the router correct in any process that loads it.
registerRelayedIntentHandlers();

// Tasks created before the ERC-8195 Rev007 submission-integrity upgrade (PR #135,
// merged 2026-06-30T18:15:06-04:00) predate the current escrow/refund flow. A wave of
// them are stuck open with expired escrow that can't be resolved on our side (no
// requester-reject path existed yet, refundExpired wasn't callable the way it is now).
// Hide them from discovery so agents stop finding tasks they can never win.
const REV007_LISTING_CUTOFF = new Date('2026-06-30T22:15:06.000Z');

// Implements: ADR-0047. The service raises HTTP statuses because its other caller is the X402
// preflight, which speaks HTTP; this maps them back for the tRPC boundary.
const EVALUATOR_ASSIGNMENT_ERROR_CODES = {
  400: 'BAD_REQUEST',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
} as const;

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

// Implements: ADR-0027 (suggest worker only when unambiguous)
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
    id: string;
    requester: string;
    claimedBy: string | null;
    evaluator: string | null;
    disputeResolver: string | null;
    taskVisibility: string;
    status: string;
    verdictType: string | null;
    submissionVisibility: string;
  },
  caller: Context['caller'],
  taskAccessGrant: Context['taskAccessGrant']
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
    // The caller already had to pass canView() to reach this point (get() returns
    // null earlier for a private task the caller can't see; update() requires the
    // caller to be the requester), so this is always viewable in practice -- passed
    // through for correctness rather than assuming it.
    taskViewability: { taskAccessGrant },
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
        .where(taskDiscoverable);
      return {
        count: result[0]?.count ?? 0,
        totalRewards: result[0]?.totalRewards ?? '0',
      };
    }),

  create: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
        method: 'POST',
        path: '/tasks',
        tags: ['Tasks'],
        summary: 'Create task (X402 required)',
      },
    })
    .input(TaskCreateSchema)
    .output(
      z.object({
        success: z.boolean(),
        /**
         * The id the chain assigned, decoded from the confirmed transaction's own
         * TaskCreated log. Present on every response this endpoint returns, because every
         * response it returns is one whose escrow has confirmed.
         *
         * A request whose receipt does not arrive in time returns nothing at all: it raises
         * the in-flight error every relayed write raises, and the id genuinely is not known
         * yet -- the transaction may still be replaced at the same nonce. That caller's
         * durable handle is the idempotency key they supplied (ADR-0052); `intents.get`
         * answers on it, and reports the task id once the intent completes (ADR-0049).
         */
        taskId: z.string(),
        /** The intent this creation is recorded as, for `intents.get` (ADR-0049). */
        intentId: z.string(),
        taskDropId: z.string().nullable(),
      })
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
          // Its own identifier, not the task's. The task has no id until its transaction
          // confirms, and a reservation has to exist before that -- it is what stops a
          // concurrent creation consuming the same drop slot.
          taskDropReservationId = `res_${randomUUID()}`;
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

      // The escrow is priced at the reward rather than the flat action fee, and the middleware
      // is what settled it at that price. Reading it back here rather than reconstructing it
      // from `input.reward` keeps the refundable amount equal to the billed amount by
      // construction, on the one route where they are most easily made to differ.
      const payment = settledPaymentReference(ctx.res);

      const taskVisibility = input.taskVisibility ?? 'public';
      const allowedViewerAddresses =
        taskVisibility === 'private'
          ? Array.from(new Set((input.allowedViewers ?? []).map((a) => a.toLowerCase())))
          : [];

      // Built by the same helper POST /tasks/{taskId}/evaluator uses, so the two ways to
      // configure an evaluator cannot drift on defaults or on the hours-to-seconds conversion.
      const evaluatorAssignment = input.evaluator
        ? buildEvaluatorAssignment({ ...input, evaluator: input.evaluator })
        : null;

      // Hashed here, on the request path, and the plaintext dropped before the payload is
      // built. The payload is persisted verbatim to `relayed_intents.payload` and read back by
      // processes that never saw the request, so a plaintext password reaching it would leave
      // a user-chosen secret sitting in a jsonb column indefinitely -- readable by anything
      // with database access, and surviving in backups long after the task it guarded ended.
      // Only the hash the task row was always going to store ever leaves this line.
      //
      // The salt is derived rather than drawn at random so that two attempts at one creation
      // produce an identical payload; see hashTaskAccessPasswordWithDerivedSalt for why that
      // is required here and why it costs the salt nothing.
      const accessPasswordHash =
        taskVisibility === 'private' && input.accessPassword
          ? hashTaskAccessPasswordWithDerivedSalt(
              input.accessPassword,
              `${ctx.idempotencyKey}:tasks.create:accessPassword`
            )
          : null;
      const intentInput = toTasksCreateInput(input);

      const payload = {
        accessPasswordHash,
        allowedViewerAddresses,
        evaluatorAssignment,
        inlineTaskDrop,
        input: intentInput,
        normalizedPayer,
        payer,
        resolvedTaskDropId,
        taskDropReservationId,
      } satisfies TasksCreateIntentPayload;

      // Recorded before the chain call, so the escrow can never be live with no durable
      // record of what it was for (ADR-0045). The payload deliberately carries neither the
      // escrow hash nor a task id: neither exists yet, and inventing either would leave the
      // persisted copy -- the only thing a reconciler pass reads back hours later -- half
      // true. Both are read off the confirmed transaction by the completion instead.
      //
      // The post-receipt work -- task row, drop, viewers, evaluator follow-on and
      // notifications -- belongs to the intent, not to this request, and runs through the
      // registry so a reconciler pass observing the same receipt cannot run it twice.
      const { intent, txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'tasks.create',
        payer,
        payment,
        payload,
        describeCompletionFailure: (intentId) =>
          `The task was created on chain but recording it did not complete; it will be retried automatically (intent ${intentId}).`,
        // Non-monetary cleanup only: the reservation is released because nothing reached the
        // chain, not because the payment is being written off. Whether it is orphaned is
        // settlement's decision alone (ADR-0048). A pending outcome never reaches here -- the
        // transaction is live, so the reservation stays held.
        onNotBroadcast: async () => {
          if (!taskDropReservationId) return;
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
        },
        // The same builder the rebroadcast sweep uses, from the same payload, so the call a
        // retry makes cannot drift from the call this request made.
        send: () => broadcastTasksCreate({ payload, paymentTxHash: payment?.txHash ?? null }),
      });

      // Returning here means the escrow confirmed and the completion ran, so the transaction
      // has a TaskCreated log and this is a second read of the same fact the completion used
      // -- not a second guess at it.
      const taskId = await taskIdForTx(txHash);

      return { success: true, taskId, intentId: intent.id, taskDropId: resolvedTaskDropId };
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
      conditions.push(taskDiscoverable);
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
          hasAccessPassword: task.privateAccessPasswordHash != null,
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
          // Passed straight through, with no `?? 0`: the column is `NOT NULL` and the value is
          // typed `number`, so a coalesce here only absorbs the compile error that would catch a
          // future widening of it.
          netReward: computeNetReward(grossPayout, task.platformFeeBps),
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

      // Phase 3 (ADR-0030): a private task's denial looks identical to "doesn't exist" --
      // returning null here (rather than throwing NOT_FOUND) is zero behavior change to
      // this endpoint's existing missing-task contract, and avoids confirming existence
      // to a caller who can't view it. Checked before any of the heavier joins/contract
      // calls below so a denied caller doesn't pay for wasted work.
      if (task.taskVisibility === 'private') {
        const viewability = await fetchPrivateViewabilityContext(ctx.db, task.id);
        if (!canView(task, ctx.caller, { taskAccessGrant: ctx.taskAccessGrant, ...viewability })) {
          return null;
        }
      }

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
      const appealAuthorization =
        task.status === 'appealing' &&
        (task.mode === 'bounty' || task.mode === 'benchmark') &&
        ctx.caller?.address
          ? await resolveAppealAuthorization(task, ctx.caller.address)
          : null;
      const appealEligibleWorker = appealAuthorization?.authorized
        ? (ctx.caller?.address ?? null)
        : null;
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
        hasAccessPassword: task.privateAccessPasswordHash != null,
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
          task.platformFeeBps
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
              ctx.caller,
              ctx.taskAccessGrant
            ),
            appealEligibleWorker,
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
        ).filter(
          (action) =>
            action.action !== 'appeal' ||
            (task.mode !== 'bounty' && task.mode !== 'benchmark') ||
            appealEligibleWorker !== null
        ),
        awards,
      };
    }),

  cancel: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'tasks.cancel',
        payer,
        payment: settledPaymentReference(ctx.res),
        // Carries the whole call, not just what the completion reads: a rebroadcast has only
        // this row to work from, and re-reading the task at broadcast time would be reading a
        // world that has moved on (ADR-0050).
        payload: {
          contractAddress: task.contractAddress,
          requester: payer,
          requesterAgentId: task.requesterAgentId ?? null,
          taskId: input.taskId,
        } satisfies TasksCancelIntentPayload,
        send: () =>
          contractCancelTask(
            input.taskId as `0x${string}`,
            payer as `0x${string}`,
            task.requesterAgentId ? BigInt(task.requesterAgentId) : 0n,
            task.contractAddress
          ),
      });

      return { txHash };
    }),

  // Implements: ADR-0047 -- evaluator assignment is its own root intent, and this is its home.
  //
  // Authorized by the X402 payer, like every other requester-only on-chain mutation here
  // (cancel, update, reject-submission). That is not just consistency: the payer address is
  // the address we relay the forwarded call as, so the contract's own `NotRequester` check
  // runs against the very address that authenticated. A signed-message scheme would prove the
  // requester's identity in the body while the relay sender came from somewhere else, giving
  // two things that must be kept in agreement instead of one thing that cannot disagree.
  assignEvaluator: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
        method: 'POST',
        path: '/tasks/{taskId}/evaluator',
        tags: ['Tasks'],
        summary: 'Assign an evaluator to an open, unclaimed task (X402 required, requester only)',
      },
    })
    .input(AssignEvaluatorInputSchema)
    .output(z.object({ txHash: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Payment required: missing payer' });
      }

      try {
        await assertEvaluatorAssignable({
          db: ctx.db,
          disputeResolver: input.disputeResolver,
          evaluator: input.evaluator,
          payer,
          taskId: input.taskId,
        });
      } catch (error) {
        if (error instanceof EvaluatorAssignmentError) {
          throw new TRPCError({
            code: EVALUATOR_ASSIGNMENT_ERROR_CODES[error.status],
            message: error.message,
          });
        }
        throw error;
      }

      const assignment = buildEvaluatorAssignment(input);

      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        // The caller's own key, as every other relayed write on this router takes it: this is a
        // request, so the client is the thing that knows which retries are the same write. Task
        // creation reaches the same operation from a completion handler with no client to ask,
        // and derives its key from the created task id instead (ADR-0052).
        idempotencyKey: ctx.idempotencyKey,
        operation: 'tasks.assignEvaluator',
        payer,
        payment: settledPaymentReference(ctx.res),
        payload: {
          assignment,
          payer,
          taskId: input.taskId,
        } satisfies TasksAssignEvaluatorIntentPayload,
        send: () => sendEvaluatorAssignment({ assignment, payer, taskId: input.taskId }),
      });

      return { txHash };
    }),

  // Implements: ADR-0026 (refundExpired is permissionless)
  // No `payer !== task.requester` guard below -- any X402-paying caller may
  // trigger a refund on any eligible expired task, matching CoreFacet's own
  // permissionless on-chain semantics.
  refundExpired: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      // Built once and used for both the payload and the send, so the transaction this request
      // makes is definitionally the one a rebroadcast reconstructs from the row (ADR-0050).
      const refundPayload = {
        requesterAgentId: task.requesterAgentId,
        taskId: input.taskId,
      } satisfies TasksRefundExpiredIntentPayload;

      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'tasks.refundExpired',
        payer,
        payment: settledPaymentReference(ctx.res),
        payload: refundPayload,
        // The same call the broadcaster reconstructs from the payload alone, so the request's
        // attempt and any rebroadcast are the same transaction (ADR-0050).
        send: () => broadcastTasksRefundExpired({ payer, payload: refundPayload }),
      });

      return { txHash };
    }),

  update: publicProcedure
    .meta({
      openapi: {
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      // 0 is the contract's documented "leave this field unchanged" sentinel, and a restated
      // reward must reach it in that shape. ADR-0054 made CoreFacet.updateTask revert
      // NoRewardChange() when a named reward equals the current one -- deliberately, because the
      // forwarder pulls the delta before the Diamond executes and the Diamond cannot return it,
      // so a silent no-op would keep the money. But a caller restating the current reward
      // alongside a genuine change ("extend the expiry, reward stays as it is") is asking for
      // nothing about the reward, not asking for a no-op change to it. Sending their literal
      // value would revert the whole update and lose the change they did want.
      const requestedReward = input.reward ? BigInt(input.reward) : 0n;
      const newReward = requestedReward === BigInt(task.reward) ? 0n : requestedReward;
      const newExpiryTime = input.expiryTime ? BigInt(input.expiryTime) : 0n;
      const newBidDeadline = input.bidDeadline ? BigInt(input.bidDeadline) : 0n;
      const newPitchDeadline = input.pitchDeadline ? BigInt(input.pitchDeadline) : 0n;

      // newReward is already 0n when the caller restated the current value, so the second
      // half of the old condition is now unreachable; kept as a single non-zero test.
      const hasOnChainChange =
        newReward !== 0n ||
        newExpiryTime !== 0n ||
        newBidDeadline !== 0n ||
        newPitchDeadline !== 0n;

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

      if (hasOnChainChange) {
        // Every argument the relay needs, resolved here and recorded, so a rebroadcast sends
        // this exact call rather than re-deriving it from a task row the first attempt may
        // already have moved (ADR-0050). currentReward is the field that makes this necessary:
        // it sizes the delta the forwarder pulls, and it is the same pre-update value the
        // middleware priced this payment from.
        const updatePayload = {
          contractAddress: task.contractAddress,
          currentReward: task.reward,
          dbUpdate,
          newBidDeadline: newBidDeadline.toString(),
          newExpiryTime: newExpiryTime.toString(),
          newPitchDeadline: newPitchDeadline.toString(),
          newReward: newReward.toString(),
          taskId: input.taskId,
        } satisfies TasksUpdateIntentPayload;

        // An update is charged the flat action fee plus any increase in the reward, so its
        // refundable amount is not the flat fee. It used to be reproduced here by handing
        // `computeUpdatePaymentAmount` the same (currentReward, requestedReward) pair the
        // middleware's `getUpdatePaymentAmount` had used -- correct, but correct only for as
        // long as the two stayed in step, and a refund sized from a diverged copy pays the
        // wrong sum out of pooled escrow. The middleware publishes what it settled instead,
        // so there is one number and no pairing to keep.
        await runRelayedIntent({
          db: ctx.db,
          idempotencyKey: ctx.idempotencyKey,
          operation: 'tasks.update',
          payer,
          payment: settledPaymentReference(ctx.res),
          payload: updatePayload,
          send: () => broadcastTasksUpdate({ payer, payload: updatePayload }),
        });
      } else if (Object.keys(dbUpdate).length > 0) {
        // Nothing on chain to wait on: an off-chain-only edit has no transaction, so there is
        // no intent for it and nothing for settlement to decide about.
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
        hasAccessPassword: t.privateAccessPasswordHash != null,
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
        netReward: computeNetReward(t.mode === 'auction' ? null : t.reward, t.platformFeeBps),
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
              ctx.caller,
              ctx.taskAccessGrant
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
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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

      const { txHash } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'tasks.rejectSubmission',
        payer,
        payment: settledPaymentReference(ctx.res),
        payload: {
          requester: payer,
          taskId: input.taskId,
          worker: input.worker,
        } satisfies TasksRejectSubmissionIntentPayload,
        send: () =>
          contractRejectSubmission(
            input.taskId as `0x${string}`,
            input.worker as `0x${string}`,
            payer as `0x${string}`
          ),
      });

      return { txHash };
    }),
});
