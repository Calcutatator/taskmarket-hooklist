import { router, publicProcedure } from '../trpc';
import { BidCreateSchema, BidResponseSchema, AuctionAcceptSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { bids, tasks, agents } from '../db/schema';
import { eq, asc, and, gt, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  contractSubmitBid,
  contractSelectLowestBidder,
  contractAcceptAuction,
} from '../services/contract';
import { authenticateXmtpDevice } from '../services/xmtp-auth';
import { computeClockPrice } from '../lib/auction';
import { TRPCError } from '@trpc/server';

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export const bidsRouter = router({
  submit: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/bids',
        tags: ['Tasks'],
        summary: 'Submit a bid on an auction task',
      },
    })
    .input(BidCreateSchema)
    .output(z.object({ success: z.boolean(), bidId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const workerAddress: string = ctx.res.locals.payer;
      if (!workerAddress) {
        throw new Error('Worker address required');
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

      if (task.mode !== 'auction') {
        throw new Error('Not an Auction task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open for bids');
      }

      if (task.bidDeadline && new Date() >= task.bidDeadline) {
        throw new Error('Bid deadline has passed');
      }

      if (task.maxPrice && BigInt(input.price) > BigInt(task.maxPrice)) {
        throw new Error('Bid exceeds max price');
      }

      // Dutch and reverse_dutch use auction-accept, not bid
      if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
        throw new Error(
          `This auction type (${task.auctionType}) uses auction-accept, not bid. Run: taskmarket task auction-accept ${task.id}`
        );
      }

      // English: new bid must undercut the current lowest bid
      if (task.auctionType === 'english') {
        const lowestBid = await ctx.db
          .select()
          .from(bids)
          .where(eq(bids.taskId, input.taskId))
          .orderBy(asc(bids.price))
          .limit(1);

        if (lowestBid.length > 0) {
          const currentLowest = BigInt(lowestBid[0].price);
          if (BigInt(input.price) >= currentLowest) {
            throw new Error(
              `Bid must undercut the current lowest bid of ${lowestBid[0].price} base units`
            );
          }
        }
      }

      // Reverse English: re-bid must be lower than worker's own previous bid
      if (task.auctionType === 'reverse_english') {
        const existingBid = await ctx.db
          .select()
          .from(bids)
          .where(and(eq(bids.taskId, input.taskId), eq(bids.workerAddress, workerAddress)))
          .limit(1);

        if (existingBid.length > 0) {
          if (BigInt(input.price) >= BigInt(existingBid[0].price)) {
            throw new Error(
              `Re-bid must be lower than your current bid of ${existingBid[0].price} base units`
            );
          }
        }
      }

      await contractSubmitBid(
        input.taskId as `0x${string}`,
        workerAddress as `0x${string}`,
        BigInt(input.price),
        task.contractAddress
      );

      // Upsert: if worker already has a bid on this task, replace it (English and Reverse English).
      // The DB unique constraint on (task_id, worker_address) enforces one bid per worker per task.
      const existingBids = await ctx.db
        .select()
        .from(bids)
        .where(and(eq(bids.taskId, input.taskId), eq(bids.workerAddress, workerAddress)))
        .limit(1);

      let bidId: string;
      if (existingBids.length > 0) {
        bidId = existingBids[0].id;
        await ctx.db
          .update(bids)
          .set({ price: input.price, createdAt: new Date() })
          .where(and(eq(bids.taskId, input.taskId), eq(bids.workerAddress, workerAddress)));
      } else {
        bidId = randomUUID();
        await ctx.db.insert(bids).values({
          id: bidId,
          taskId: input.taskId,
          workerAddress,
          price: input.price,
        });
      }

      return { success: true, bidId };
    }),

  listByTask: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/bids',
        tags: ['Tasks'],
        summary: 'List bids for an auction task',
      },
    })
    .input(z.object({ taskId: z.string(), callerAddress: z.string().optional() }))
    .output(z.array(BidResponseSchema))
    .query(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      const task = taskResult[0] ?? null;
      const now = new Date();
      const deadlinePassed = task?.bidDeadline ? now >= task.bidDeadline : true;

      // For reverse_english before deadline: bids are fully sealed
      const isSealed =
        task?.auctionType === 'reverse_english' && task?.status === 'open' && !deadlinePassed;

      const results = await ctx.db
        .select()
        .from(bids)
        .where(eq(bids.taskId, input.taskId))
        .orderBy(asc(bids.price));

      return Promise.all(
        results.map(async (bid) => {
          if (isSealed) {
            // Hide price and address before deadline for sealed bids
            return {
              id: bid.id,
              taskId: bid.taskId,
              workerAddress: null,
              price: null,
              createdAt: bid.createdAt.toISOString(),
              workerAgentId: null,
              isMyBid:
                input.callerAddress != null
                  ? bid.workerAddress.toLowerCase() === input.callerAddress.toLowerCase()
                  : undefined,
            };
          }

          const agentResult = await ctx.db
            .select()
            .from(agents)
            .where(eq(agents.address, bid.workerAddress))
            .limit(1);

          return {
            id: bid.id,
            taskId: bid.taskId,
            workerAddress: bid.workerAddress,
            price: bid.price,
            createdAt: bid.createdAt.toISOString(),
            workerAgentId: agentResult[0]?.agentId ?? null,
            isMyBid:
              input.callerAddress != null
                ? bid.workerAddress.toLowerCase() === input.callerAddress.toLowerCase()
                : undefined,
          };
        })
      );
    }),

  selectWinner: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/bids/select-winner',
        tags: ['Tasks'],
        summary: 'Select lowest bidder after deadline (server only)',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(z.object({ success: z.boolean(), workerAddress: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new Error('Task not found');
      }

      const task = taskResult[0];

      if (task.mode !== 'auction') {
        throw new Error('Not an Auction task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open');
      }

      if (task.bidDeadline && new Date() < task.bidDeadline) {
        throw new Error('Bid deadline has not passed yet');
      }

      // Dutch/Reverse Dutch use auction-accept for immediate selection
      if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
        throw new Error(
          `${task.auctionType} auctions use auction-accept for immediate selection, not select-winner`
        );
      }

      await contractSelectLowestBidder(input.taskId as `0x${string}`, task.contractAddress);

      const lowestBid = await ctx.db
        .select()
        .from(bids)
        .where(eq(bids.taskId, input.taskId))
        .orderBy(asc(bids.price))
        .limit(1);

      if (lowestBid.length === 0) {
        throw new Error('No bids found');
      }

      const winner = lowestBid[0];

      await ctx.db
        .update(tasks)
        .set({
          status: 'claimed',
          worker: winner.workerAddress,
        })
        .where(eq(tasks.id, input.taskId));

      return { success: true, workerAddress: winner.workerAddress };
    }),

  auctionAccept: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/bids/accept',
        tags: ['Tasks'],
        summary:
          'Accept current clock price on a dutch or reverse_dutch auction task (X402 required)',
      },
    })
    .input(AuctionAcceptSchema)
    .output(
      z.object({ success: z.boolean(), acceptedPrice: z.string(), workerAddress: z.string() })
    )
    .mutation(async ({ input, ctx }) => {
      const workerAddress: string = ctx.res.locals.payer;
      if (!workerAddress) {
        throw new Error('Worker address required');
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

      if (task.mode !== 'auction') {
        throw new Error('Not an auction task');
      }

      if (task.auctionType !== 'dutch' && task.auctionType !== 'reverse_dutch') {
        throw new Error(
          `auction-accept is only for dutch and reverse_dutch auctions. This task is ${task.auctionType || 'untyped'}.`
        );
      }

      if (task.status !== 'open') {
        throw new Error('Task is not open');
      }

      if (task.bidDeadline && new Date() >= task.bidDeadline) {
        throw new Error('Bid deadline has passed — auction clock has expired');
      }

      const now = new Date();
      const clockPrice = computeClockPrice(task, now);
      if (clockPrice === null) {
        throw new Error('Could not compute current clock price');
      }

      // Optional minPrice guard
      if (input.minPrice) {
        const minPrice = BigInt(input.minPrice);
        if (clockPrice < minPrice) {
          throw new Error(
            `Clock price (${clockPrice} base units) is below your minimum (${minPrice} base units). Current price: ${clockPrice}`
          );
        }
      }

      // Call contract first — if it reverts, DB is untouched and the task stays open
      await contractAcceptAuction(
        input.taskId as `0x${string}`,
        workerAddress as `0x${string}`,
        clockPrice,
        task.contractAddress
      );

      // Conditional DB update: only succeeds if task is still 'open' (race guard)
      const updated = await ctx.db
        .update(tasks)
        .set({
          status: 'claimed',
          worker: workerAddress,
          claimedBy: workerAddress,
          claimedAt: now,
        })
        .where(and(eq(tasks.id, input.taskId), eq(tasks.status, 'open')))
        .returning();

      if (!updated || updated.length === 0) {
        throw new Error('Auction already claimed by another worker');
      }

      // Record the bid in DB
      await ctx.db.insert(bids).values({
        id: randomUUID(),
        taskId: input.taskId,
        workerAddress,
        price: clockPrice.toString(),
      });

      return {
        success: true,
        acceptedPrice: clockPrice.toString(),
        workerAddress,
      };
    }),

  myBids: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/bids/my',
        tags: ['Tasks'],
        summary: 'List my active pending bids on auction tasks',
      },
    })
    .input(
      z.object({
        deviceId: z.string(),
      })
    )
    .output(
      z.array(
        z.object({
          taskId: z.string(),
          auctionType: z.string().nullable(),
          myBidPrice: z.string(),
          currentLowestBid: z.string().nullable(),
          bidDeadline: z.string().nullable(),
          bidCount: z.number(),
          taskStatus: z.string(),
        })
      )
    )
    .query(async ({ input, ctx }) => {
      const apiToken = headerValue(ctx.req.headers['x-taskmarket-api-token']);
      if (!apiToken) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Missing x-taskmarket-api-token header',
        });
      }
      const device = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken,
      });

      const now = new Date();

      // Correlated subqueries aggregate over ALL bids per task, not just the caller's.
      const rows = await ctx.db
        .select({
          taskId: tasks.id,
          auctionType: tasks.auctionType,
          bidDeadline: tasks.bidDeadline,
          taskStatus: tasks.status,
          myBidPrice: bids.price,
          bidCount: sql<number>`(select count(*)::int from bids b2 where b2.task_id = ${bids.taskId})`,
          lowestBid: sql<
            string | null
          >`(select min(b2.price::numeric)::text from bids b2 where b2.task_id = ${bids.taskId})`,
        })
        .from(bids)
        .innerJoin(tasks, eq(bids.taskId, tasks.id))
        .where(
          and(
            eq(bids.workerAddress, device.walletAddress),
            eq(tasks.status, 'open'),
            gt(tasks.bidDeadline, now)
          )
        )
        .orderBy(asc(tasks.bidDeadline));

      return rows.map((row) => ({
        taskId: row.taskId,
        auctionType: row.auctionType,
        myBidPrice: row.myBidPrice,
        // For English show the current lowest bid across all bidders; for others not relevant
        currentLowestBid: row.auctionType === 'english' ? row.lowestBid : null,
        bidDeadline: row.bidDeadline?.toISOString() ?? null,
        bidCount: row.bidCount,
        taskStatus: row.taskStatus,
      }));
    }),
});
