import { router, publicProcedure } from '../trpc';
import {
  TaskCreateSchema,
  TaskListInputSchema,
  TaskListResponseSchema,
  TaskDetailResponseSchema,
  CancelTaskInputSchema,
  UpdateTaskInputSchema,
  type PendingAction,
  type TaskStatusType,
  type TaskModeType,
  type AuctionTypeValue,
} from '@taskmarket/shared';
import { z } from 'zod';
import { tasks, submissions, proposals, agents, bids } from '../db/schema';
import { eq, sql, desc, and, gt, lt, lte, arrayOverlaps, asc, inArray } from 'drizzle-orm';
import {
  contractCreateTask,
  contractCancelTask,
  contractUpdateTask,
  MODE_MAP,
  AUCTION_SUBTYPE_MAP,
  precomputeTaskId,
} from '../services/contract';
import { getServerConfig } from '../config/env';
import { computeClockPrice, computePriceTimestamp } from '../lib/auction';

function computePendingActions(task: {
  id: string;
  status: string;
  mode: string;
  rating: number | null;
  pitchCount: number;
  bidCount: number;
  expiryTime: Date;
  bidDeadline: Date | null;
  claimedBy: string | null;
  worker: string | null;
  auctionType: string | null;
  currentClockPrice: bigint | null;
  currentLowestBid: string | null;
}): PendingAction[] {
  if (task.status === 'open' && task.expiryTime < new Date()) {
    return [];
  }

  const id = task.id;
  const workerAddr = task.worker ?? task.claimedBy;
  const now = new Date();

  switch (task.status) {
    case 'open': {
      const canCancel = task.mode !== 'auction' || task.bidCount === 0;
      const managementActions: PendingAction[] = canCancel
        ? [
            { role: 'requester', action: 'cancel', command: `taskmarket task cancel ${id}` },
            {
              role: 'requester',
              action: 'update',
              command: `taskmarket task update ${id} [--reward <usdc>] [--extend-expiry <seconds>]`,
            },
          ]
        : [];

      switch (task.mode) {
        case 'bounty':
          return [
            ...managementActions,
            {
              role: 'worker',
              action: 'submit',
              command: `taskmarket task submit ${id} --file <path>`,
            },
          ];
        case 'claim':
          return [
            ...managementActions,
            { role: 'worker', action: 'claim', command: `taskmarket task claim ${id}` },
          ];
        case 'pitch': {
          const actions: PendingAction[] = [
            ...managementActions,
            {
              role: 'worker',
              action: 'pitch',
              command: `taskmarket task pitch ${id} --text "..."`,
            },
          ];
          if (task.pitchCount > 0) {
            actions.push({
              role: 'requester',
              action: 'select_worker',
              command: `taskmarket task select-worker ${id} --pitch <pitchId> --worker <address>`,
            });
          }
          return actions;
        }
        case 'benchmark':
          return [
            ...managementActions,
            {
              role: 'worker',
              action: 'submit_proof',
              command: `taskmarket task proof ${id} --data <data> --type <type>`,
            },
          ];
        case 'auction': {
          const deadlinePassed = task.bidDeadline && now >= task.bidDeadline;

          if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
            if (deadlinePassed) {
              // No more actions — clock window closed with no taker
              return [];
            }
            const priceStr =
              task.currentClockPrice !== null
                ? (Number(task.currentClockPrice) / 1_000_000).toFixed(6)
                : '?';
            return [
              {
                role: 'worker',
                action: 'auction_accept',
                command: `taskmarket task auction-accept ${id} # current price: $${priceStr}`,
              },
            ];
          }

          // English / Reverse English
          if (deadlinePassed) {
            if (task.bidCount > 0) {
              return [
                {
                  role: 'requester',
                  action: 'select_winner',
                  command: `taskmarket task select-winner ${id}`,
                },
              ];
            }
            return [];
          }

          if (task.auctionType === 'english') {
            const lowestComment =
              task.currentLowestBid !== null
                ? ` # current lowest: $${(Number(task.currentLowestBid) / 1_000_000).toFixed(6)}`
                : '';
            return [
              {
                role: 'worker',
                action: 'bid',
                command: `taskmarket task bid ${id} --price <n>${lowestComment}`,
              },
            ];
          }

          // reverse_english
          return [
            {
              role: 'worker',
              action: 'bid',
              command: `taskmarket task bid ${id} --price <n> # ${task.bidCount} sealed bid(s) placed`,
            },
          ];
        }
        default:
          return [];
      }
    }
    case 'claimed':
      return [
        { role: 'worker', action: 'submit', command: `taskmarket task submit ${id} --file <path>` },
      ];
    case 'worker_selected':
      return [
        { role: 'worker', action: 'submit', command: `taskmarket task submit ${id} --file <path>` },
      ];
    case 'pending_approval': {
      const addr = workerAddr ?? '<address>';
      return [
        {
          role: 'requester',
          action: 'accept',
          command: `taskmarket task accept ${id} --worker ${addr}`,
        },
      ];
    }
    case 'accepted':
      if (task.rating === null) {
        const addr = workerAddr ?? '<address>';
        return [
          {
            role: 'requester',
            action: 'rate',
            command: `taskmarket task rate ${id} --worker ${addr} --rating <0-100>`,
          },
        ];
      }
      return [];
    default:
      return [];
  }
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
        .from(tasks);
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
    .output(z.object({ success: z.boolean(), taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new Error('Payment required: missing payer');
      }

      if (input.mode === 'auction') {
        if (!input.maxPrice) {
          throw new Error('maxPrice is required for auction mode');
        }
        if (!input.auctionType) {
          throw new Error(
            'auctionType is required for auction mode (dutch, english, reverse_dutch, reverse_english)'
          );
        }
        if (input.auctionType === 'reverse_dutch' && !input.auctionStartPrice) {
          throw new Error('auctionStartPrice is required for reverse_dutch auction type');
        }
        if (input.auctionType === 'dutch' && !input.auctionFloorPrice) {
          throw new Error('auctionFloorPrice is required for dutch auction type');
        }
      }

      const config = getServerConfig();
      const reward = BigInt(input.reward);
      const durationSecs = BigInt(input.duration * 3600);
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

      const auctionSubtype =
        input.mode === 'auction' && input.auctionType
          ? (AUCTION_SUBTYPE_MAP[input.auctionType] ?? ('0x00000000' as `0x${string}`))
          : ('0x00000000' as `0x${string}`);

      const paymentTxHash = ctx.res.locals.paymentTxHash as `0x${string}` | undefined;
      const escrowTxHash = await contractCreateTask(
        payer as `0x${string}`,
        reward,
        durationSecs,
        mode,
        pitchDeadlineSecs,
        bidDeadlineSecs,
        auctionSubtype,
        paymentTxHash
      );

      const expiryTime = new Date(Date.now() + input.duration * 3600 * 1000);

      const requesterAgent = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(eq(agents.address, payer))
        .limit(1);

      await ctx.db.insert(tasks).values({
        id: taskId,
        requester: payer,
        requesterPubkey: payer,
        description: input.description,
        reward: input.reward,
        escrowTxHash,
        expiryTime,
        status: 'open',
        tags: input.tags,
        mode: input.mode ?? 'bounty',
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
      });

      return { success: true, taskId };
    }),

  list: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/tasks', tags: ['Tasks'], summary: 'List tasks' } })
    .input(TaskListInputSchema)
    .output(TaskListResponseSchema)
    .query(async ({ input, ctx }) => {
      const limit = input.limit || 20;
      const now = new Date();

      const conditions = [];
      if (input.status && input.status !== 'ALL') {
        conditions.push(eq(tasks.status, input.status));
      }
      if (input.mode && input.mode !== 'ALL') {
        conditions.push(eq(tasks.mode, input.mode));
      }
      if (input.auctionType) {
        conditions.push(eq(tasks.auctionType, input.auctionType));
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
      if (input.cursor) {
        conditions.push(lt(tasks.createdAt, new Date(input.cursor)));
      }

      const results = await ctx.db
        .select()
        .from(tasks)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(tasks.createdAt))
        .limit(limit + 1);

      const hasMore = results.length > limit;
      const tasksList = hasMore ? results.slice(0, limit) : results;

      // Batch all per-task counts in three queries instead of N*3 queries.
      const listIds = tasksList.map((t) => t.id);

      const [submissionCountRows, pitchCountRows, bidAggRows] = await Promise.all([
        listIds.length > 0
          ? ctx.db
              .select({ taskId: submissions.taskId, count: sql<number>`count(*)::int` })
              .from(submissions)
              .where(inArray(submissions.taskId, listIds))
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
      ]);

      const submissionCountMap = new Map(submissionCountRows.map((r) => [r.taskId, r.count]));
      const pitchCountMap = new Map(pitchCountRows.map((r) => [r.taskId, r.count]));
      const bidAggMap = new Map(bidAggRows.map((r) => [r.taskId, r]));

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

        return {
          id: task.id,
          requester: task.requester,
          requesterPubkey: task.requesterPubkey,
          description: task.description,
          reward: task.reward,
          escrowTxHash: task.escrowTxHash,
          createdAt: task.createdAt.toISOString(),
          expiryTime: task.expiryTime.toISOString(),
          status: task.status as TaskStatusType,
          tags: task.tags,
          worker: task.worker,
          rating: task.rating,
          mode: task.mode as TaskModeType,
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
          pitchCount: Number(pitchCountMap.get(task.id) ?? 0),
          requesterAgentId: task.requesterAgentId ?? null,
          auctionType: (task.auctionType as AuctionTypeValue | null) ?? null,
          auctionStartPrice: task.auctionStartPrice ?? null,
          auctionFloorPrice: task.auctionFloorPrice ?? null,
          currentAuctionPrice,
          auctionBidCount,
          currentLowestBid,
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

      const submissionCount = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(submissions)
        .where(eq(submissions.taskId, task.id));

      const pitchCount = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(proposals)
        .where(eq(proposals.taskId, task.id));

      const workerAddress = task.worker ?? task.claimedBy;
      const workerAgent = workerAddress
        ? await ctx.db
            .select({ agentId: agents.agentId })
            .from(agents)
            .where(eq(agents.address, workerAddress))
            .limit(1)
        : [];

      // Auction-specific computed fields
      let auctionBidCount: number | null = null;
      let currentAuctionPrice: string | null = null;
      let auctionPriceReachesFloorAt: string | null = null;
      let auctionPriceReachesMaxAt: string | null = null;
      let currentLowestBid: string | null = null;

      if (task.mode === 'auction') {
        const bidCountResult = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bids)
          .where(eq(bids.taskId, task.id));
        auctionBidCount = Number(bidCountResult[0]?.count ?? 0);

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

      return {
        id: task.id,
        requester: task.requester,
        requesterPubkey: task.requesterPubkey,
        description: task.description,
        reward: task.reward,
        escrowTxHash: task.escrowTxHash,
        createdAt: task.createdAt.toISOString(),
        expiryTime: task.expiryTime.toISOString(),
        status: task.status as any,
        tags: task.tags,
        worker: task.worker,
        rating: task.rating,
        mode: task.mode as any,
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
        pitchCount: pitchCountNum,
        requesterAgentId: task.requesterAgentId ?? null,
        workerAgentId: workerAgent[0]?.agentId ?? null,
        auctionType: (task.auctionType as any) ?? null,
        auctionStartPrice: task.auctionStartPrice ?? null,
        auctionFloorPrice: task.auctionFloorPrice ?? null,
        currentAuctionPrice,
        auctionBidCount,
        auctionPriceReachesFloorAt,
        auctionPriceReachesMaxAt,
        currentLowestBid,
        pendingActions: computePendingActions({
          id: task.id,
          status: task.status,
          mode: task.mode,
          rating: task.rating,
          pitchCount: pitchCountNum,
          bidCount: auctionBidCount ?? 0,
          expiryTime: task.expiryTime,
          bidDeadline: task.bidDeadline,
          claimedBy: task.claimedBy,
          worker: task.worker,
          auctionType: task.auctionType,
          currentClockPrice: clockPrice,
          currentLowestBid,
        }),
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
        throw new Error('Only the task requester can cancel');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open');
      }

      if (task.mode === 'auction') {
        const bidCount = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bids)
          .where(eq(bids.taskId, input.taskId));
        if (Number(bidCount[0]?.count ?? 0) > 0) {
          throw new Error('Bids exist — cannot cancel auction with bids');
        }
      }

      const txHash = await contractCancelTask(
        input.taskId as `0x${string}`,
        payer as `0x${string}`,
        task.contractAddress
      );

      await ctx.db
        .update(tasks)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(tasks.id, input.taskId));

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
        throw new Error('Only the task requester can update');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open');
      }

      if (task.mode === 'auction') {
        const bidCount = await ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(bids)
          .where(eq(bids.taskId, input.taskId));
        if (Number(bidCount[0]?.count ?? 0) > 0) {
          throw new Error('Bids exist — cannot update auction with bids');
        }
      }

      const effectiveReward = input.reward ?? task.reward;
      if (input.auctionFloorPrice && BigInt(input.auctionFloorPrice) > BigInt(effectiveReward)) {
        throw new Error('auctionFloorPrice must be <= reward');
      }
      if (input.auctionStartPrice && BigInt(input.auctionStartPrice) > BigInt(effectiveReward)) {
        throw new Error('auctionStartPrice must be <= reward');
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

      const updatedSubmissionCount = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(submissions)
        .where(eq(submissions.taskId, t.id));

      const updatedPitchCount = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(proposals)
        .where(eq(proposals.taskId, t.id));

      return {
        id: t.id,
        requester: t.requester,
        requesterPubkey: t.requesterPubkey,
        description: t.description,
        reward: t.reward,
        escrowTxHash: t.escrowTxHash,
        createdAt: t.createdAt.toISOString(),
        expiryTime: t.expiryTime.toISOString(),
        status: t.status as TaskStatusType,
        tags: t.tags,
        worker: t.worker,
        rating: t.rating,
        mode: t.mode as TaskModeType,
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
        pendingActions: computePendingActions({
          id: t.id,
          status: t.status,
          mode: t.mode,
          rating: t.rating,
          pitchCount: Number(updatedPitchCount[0]?.count || 0),
          bidCount: auctionBidCount ?? 0,
          expiryTime: t.expiryTime,
          bidDeadline: t.bidDeadline,
          claimedBy: t.claimedBy,
          worker: t.worker,
          auctionType: t.auctionType,
          currentClockPrice:
            updateCurrentAuctionPrice !== null ? BigInt(updateCurrentAuctionPrice) : null,
          currentLowestBid: updateCurrentLowestBid,
        }),
      };
    }),
});
