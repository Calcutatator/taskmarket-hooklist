import { router, publicProcedure, protectedProcedure, optionalAuthProcedure } from '../trpc';
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
import { computeClockPrice } from '../lib/auction';
import { lowerAddressEq, verifySignedAddressOrThrow } from '../lib/agents';
import {
  canView,
  fetchPrivateViewabilityContext,
  resolveTaskViewability,
} from '../lib/task-visibility';
import { TRPCError } from '@trpc/server';
import { runRelayedIntent } from '../services/relayed-intent-request';
import type {
  BidsAuctionAcceptIntentPayload,
  BidsSubmitIntentPayload,
} from '../services/intents/bids-intents';

// Implements: ADR-0023 (myBids self-auth converged onto ctx.caller)
// myBids below is now a protectedProcedure deriving the caller's address from
// ctx.caller.address (the general read-auth header) instead of the bespoke,
// removed address/signature input scheme (ADR-0017, superseded).
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
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Worker address required' });
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

      // Phase 3 (ADR-0030) gates who may even VIEW a private task, but placing a bid
      // is a write action, not a read: unlike `listByTask` (below), which reuses
      // `canView` as-is, a bare `taskAccessGrant` (the view-only password credential
      // minted by taskAccess.verifyPassword -- see lib/task-visibility.ts) must NOT be
      // sufficient to bid. That credential is handed out purely for previewing a
      // private task and is never wallet-bound, so treating it as bid authorization
      // would let anyone who merely knows the share password place a real bid under
      // any address they control. Deliberately omitting `taskAccessGrant` from the
      // context passed to `canView` here (rather than forwarding ctx.taskAccessGrant)
      // is what keeps the grant read-only: only the requester, an allowlisted wallet,
      // or an already-claimed/awarded worker address may bid on a private task.
      if (task.taskVisibility === 'private') {
        const viewability = await fetchPrivateViewabilityContext(ctx.db, task.id);
        if (!canView(task, { address: workerAddress }, viewability)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Not authorized to bid on this private task',
          });
        }
      }

      if (task.mode !== 'auction') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an Auction task' });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not open for bids' });
      }

      if (task.bidDeadline && new Date() >= task.bidDeadline) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bid deadline has passed' });
      }

      if (task.maxPrice && BigInt(input.price) > BigInt(task.maxPrice)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bid exceeds max price' });
      }

      // Dutch and reverse_dutch use auction-accept, not bid
      if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `This auction type (${task.auctionType}) uses auction-accept, not bid. Run: taskmarket task auction-accept ${task.id}`,
        });
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
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Bid must undercut the current lowest bid of ${lowestBid[0].price} base units`,
            });
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
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Re-bid must be lower than your current bid of ${existingBid[0].price} base units`,
            });
          }
        }
      }

      // The bid id is generated here rather than in the completion so the response can name
      // it without a second read, but the row that actually persists wins: a re-bid or the
      // indexer's own write of the same BidSubmitted event may already hold this
      // (task, worker) pair, and the unique constraint means there is only ever one row.
      const bidId = randomUUID();

      await runRelayedIntent({
        db: ctx.db,
        operation: 'bids.submit',
        payer: workerAddress,
        paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
        payload: {
          bidId,
          price: input.price,
          taskId: input.taskId,
          workerAddress,
        } satisfies BidsSubmitIntentPayload,
        send: () =>
          contractSubmitBid(
            input.taskId as `0x${string}`,
            workerAddress as `0x${string}`,
            BigInt(input.price),
            task.contractAddress
          ),
      });

      const [bidRow] = await ctx.db
        .select({ id: bids.id })
        .from(bids)
        .where(and(eq(bids.taskId, input.taskId), eq(bids.workerAddress, workerAddress)))
        .limit(1);

      return { success: true, bidId: bidRow?.id ?? bidId };
    }),

  listByTask: optionalAuthProcedure
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
      const { task, viewable } = await resolveTaskViewability(
        ctx.db,
        input.taskId,
        ctx.caller,
        ctx.taskAccessGrant
      );

      // Phase 3 (ADR-0030): a private task the caller can't view returns no bids at
      // all, matching this endpoint's pre-existing lenient "unknown taskId returns []"
      // behavior -- no new existence-confirming signal. Composes as an AND with the
      // auction bid-sealing logic below, not a replacement for it: a viewable,
      // non-private, still-sealed auction still hides workerAddress/price pre-deadline.
      if (!viewable) return [];

      const now = new Date();
      const deadlinePassed = task?.bidDeadline ? now >= task.bidDeadline : true;

      // For reverse_english before deadline: bids are fully sealed
      const isSealed =
        task?.auctionType === 'reverse_english' && task?.status === 'open' && !deadlinePassed;

      const callerAddress = ctx.caller?.address;

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
                callerAddress != null
                  ? bid.workerAddress.toLowerCase() === callerAddress.toLowerCase()
                  : undefined,
            };
          }

          const agentResult = await ctx.db
            .select()
            .from(agents)
            .where(lowerAddressEq(bid.workerAddress))
            .limit(1);

          return {
            id: bid.id,
            taskId: bid.taskId,
            workerAddress: bid.workerAddress,
            price: bid.price,
            createdAt: bid.createdAt.toISOString(),
            workerAgentId: agentResult[0]?.agentId ?? null,
            isMyBid:
              callerAddress != null
                ? bid.workerAddress.toLowerCase() === callerAddress.toLowerCase()
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
        summary: 'Permissionlessly finalize the lowest bidder after the deadline',
      },
    })
    .input(
      z.object({
        taskId: z.string(),
        requesterAddress: z.string().optional(),
        signature: z.string().optional(),
      })
    )
    .output(z.object({ success: z.boolean(), workerAddress: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      }

      const task = taskResult[0];

      if (input.requesterAddress || input.signature) {
        if (!input.requesterAddress || !input.signature) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Both requesterAddress and signature must be provided together',
          });
        }
        const message = `taskmarket:select-winner:${input.taskId}`;
        await verifySignedAddressOrThrow(message, input.signature, input.requesterAddress, {
          invalid_signature: () =>
            new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' }),
          address_mismatch: () =>
            new TRPCError({
              code: 'UNAUTHORIZED',
              message: 'Signature does not match requester address',
            }),
        });
        if (task.requester.toLowerCase() !== input.requesterAddress.toLowerCase()) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the task requester can select the winner',
          });
        }
      }

      if (task.mode !== 'auction') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an Auction task' });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task not open' });
      }

      if (task.bidDeadline && new Date() < task.bidDeadline) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bid deadline has not passed yet' });
      }

      // Dutch/Reverse Dutch use auction-accept for immediate selection
      if (task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${task.auctionType} auctions use auction-accept for immediate selection, not select-winner`,
        });
      }

      await contractSelectLowestBidder(input.taskId as `0x${string}`, task.contractAddress);

      const lowestBid = await ctx.db
        .select()
        .from(bids)
        .where(eq(bids.taskId, input.taskId))
        .orderBy(asc(bids.price))
        .limit(1);

      if (lowestBid.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No bids found' });
      }

      const winner = lowestBid[0];

      await ctx.db
        .update(tasks)
        .set({
          status: 'claimed',
          claimedBy: winner.workerAddress,
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
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Worker address required' });
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

      // Phase 3 (ADR-0030) gates who may even VIEW a private task, but accepting a
      // dutch/reverse_dutch auction is a write action, not a read -- the same reasoning
      // as `submit`'s identical check above for english/reverse_english bids. A bare
      // `taskAccessGrant` (the view-only password credential minted by
      // taskAccess.verifyPassword -- see lib/task-visibility.ts) must NOT be sufficient
      // to accept: that credential is handed out purely for previewing a private task
      // and is never wallet-bound, so treating it as accept authorization would let
      // anyone who merely knows the share password claim a real auction task under any
      // address they control. Deliberately omitting `taskAccessGrant` from the context
      // passed to `canView` here (rather than forwarding ctx.taskAccessGrant) is what
      // keeps the grant read-only: only the requester, an allowlisted wallet, or an
      // already-claimed/awarded worker address may accept a private auction task.
      if (task.taskVisibility === 'private') {
        const viewability = await fetchPrivateViewabilityContext(ctx.db, task.id);
        if (!canView(task, { address: workerAddress }, viewability)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Not authorized to accept this private task',
          });
        }
      }

      if (task.mode !== 'auction') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an auction task' });
      }

      if (task.auctionType !== 'dutch' && task.auctionType !== 'reverse_dutch') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `auction-accept is only for dutch and reverse_dutch auctions. This task is ${task.auctionType || 'untyped'}.`,
        });
      }

      if (task.status !== 'open') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is not open' });
      }

      if (task.bidDeadline && new Date() >= task.bidDeadline) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Bid deadline has passed — auction clock has expired',
        });
      }

      const now = new Date();
      const clockPrice = computeClockPrice(task, now);
      if (clockPrice === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Could not compute current clock price',
        });
      }

      // Optional minPrice guard
      if (input.minPrice) {
        const minPrice = BigInt(input.minPrice);
        if (clockPrice < minPrice) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Clock price (${clockPrice} base units) is below your minimum (${minPrice} base units). Current price: ${clockPrice}`,
          });
        }
      }

      await runRelayedIntent({
        db: ctx.db,
        operation: 'bids.auctionAccept',
        payer: workerAddress,
        paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
        payload: {
          acceptedAt: now.toISOString(),
          bidId: randomUUID(),
          price: clockPrice.toString(),
          taskId: input.taskId,
          workerAddress,
        } satisfies BidsAuctionAcceptIntentPayload,
        send: () =>
          contractAcceptAuction(
            input.taskId as `0x${string}`,
            workerAddress as `0x${string}`,
            clockPrice,
            task.contractAddress
          ),
      });

      return {
        success: true,
        acceptedPrice: clockPrice.toString(),
        workerAddress,
      };
    }),

  myBids: protectedProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/bids/my',
        tags: ['Tasks'],
        summary: 'List my active pending bids on auction tasks',
      },
    })
    .input(z.object({}))
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
    .query(async ({ ctx }) => {
      // Proof that the caller owns the address -- the general read-auth
      // header (ADR-0016/ADR-0022), resolved once per request in context.ts.
      // Unlike agents.inbox there is no public fallback view: "my bids" has no
      // meaning without a verified caller, so protectedProcedure hard-fails
      // with UNAUTHORIZED when ctx.caller is absent, preserving ADR-0017's
      // original hard-fail behavior under the new mechanism.
      const address = ctx.caller.address;

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
            sql`lower(${bids.workerAddress}) = lower(${address})`,
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
