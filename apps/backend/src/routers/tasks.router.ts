import { router, publicProcedure } from '../trpc';
import {
  TaskCreateSchema,
  TaskListInputSchema,
  TaskListResponseSchema,
  TaskDetailResponseSchema,
  type PendingAction,
  type TaskStatusType,
  type TaskModeType,
  type AuctionTypeValue,
} from '@taskmarket/shared';
import { z } from 'zod';
import { tasks, submissions, proposals, agents, bids } from '../db/schema';
import { eq, sql, desc, and, gt, lt, lte, arrayOverlaps, asc } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { contractCreateTask, MODE_MAP } from '../services/contract';
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
    case 'open':
      switch (task.mode) {
        case 'bounty':
          return [
            {
              role: 'worker',
              action: 'submit',
              command: `taskmarket task submit ${id} --file <path>`,
            },
          ];
        case 'claim':
          return [{ role: 'worker', action: 'claim', command: `taskmarket task claim ${id}` }];
        case 'pitch': {
          const actions: PendingAction[] = [
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
      }

      const config = getServerConfig();
      const taskId = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
      const reward = BigInt(input.reward);
      const durationSecs = BigInt(input.duration * 3600);
      const mode = MODE_MAP[input.mode ?? 'bounty'] ?? 0;

      const pitchDeadlineSecs =
        input.mode === 'pitch'
          ? input.pitchDeadline
            ? BigInt(input.pitchDeadline)
            : durationSecs
          : 0n;

      const bidDeadlineSecs =
        input.mode === 'auction'
          ? input.bidDeadline
            ? BigInt(input.bidDeadline * 3600)
            : durationSecs
          : 0n;

      const paymentTxHash = ctx.res.locals.paymentTxHash as `0x${string}` | undefined;
      const escrowTxHash = await contractCreateTask(
        taskId,
        payer as `0x${string}`,
        reward,
        durationSecs,
        mode,
        pitchDeadlineSecs,
        bidDeadlineSecs,
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

      const tasksWithCounts = await Promise.all(
        tasksList.map(async (task) => {
          const submissionCount = await ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(submissions)
            .where(eq(submissions.taskId, task.id));

          const pitchCount = await ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(proposals)
            .where(eq(proposals.taskId, task.id));

          let auctionBidCount: number | null = null;
          let currentAuctionPrice: string | null = null;
          let currentLowestBid: string | null = null;

          if (task.mode === 'auction') {
            const bidCountResult = await ctx.db
              .select({ count: sql<number>`count(*)::int` })
              .from(bids)
              .where(eq(bids.taskId, task.id));
            auctionBidCount = Number(bidCountResult[0]?.count ?? 0);

            if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
              const price = computeClockPrice(task, now);
              currentAuctionPrice = price !== null ? price.toString() : null;
            }

            if (task.auctionType === 'english') {
              const lowestBid = await ctx.db
                .select()
                .from(bids)
                .where(eq(bids.taskId, task.id))
                .orderBy(asc(bids.price))
                .limit(1);
              currentLowestBid = lowestBid[0]?.price ?? null;
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
            submissionCount: Number(submissionCount[0]?.count || 0),
            pitchCount: Number(pitchCount[0]?.count || 0),
            requesterAgentId: task.requesterAgentId ?? null,
            auctionType: (task.auctionType as AuctionTypeValue | null) ?? null,
            auctionStartPrice: task.auctionStartPrice ?? null,
            auctionFloorPrice: task.auctionFloorPrice ?? null,
            currentAuctionPrice,
            auctionBidCount,
            currentLowestBid,
          };
        })
      );

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
});
