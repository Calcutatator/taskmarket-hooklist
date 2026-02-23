import { router, publicProcedure } from '../trpc';
import { BidCreateSchema, BidResponseSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { bids, tasks } from '../db/schema';
import { eq, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { contractSubmitBid, contractSelectLowestBidder } from '../services/contract';

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

      await contractSubmitBid(
        input.taskId as `0x${string}`,
        workerAddress as `0x${string}`,
        BigInt(input.price)
      );

      const bidId = randomUUID();

      await ctx.db.insert(bids).values({
        id: bidId,
        taskId: input.taskId,
        workerAddress,
        price: input.price,
      });

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
    .input(z.object({ taskId: z.string() }))
    .output(z.array(BidResponseSchema))
    .query(async ({ input, ctx }) => {
      const results = await ctx.db
        .select()
        .from(bids)
        .where(eq(bids.taskId, input.taskId))
        .orderBy(asc(bids.price));

      return results.map((bid) => ({
        id: bid.id,
        taskId: bid.taskId,
        workerAddress: bid.workerAddress,
        price: bid.price,
        createdAt: bid.createdAt.toISOString(),
      }));
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

      await contractSelectLowestBidder(input.taskId as `0x${string}`);

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
});
