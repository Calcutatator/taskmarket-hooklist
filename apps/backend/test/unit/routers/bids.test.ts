import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { createIntentCtx, makeChain } from '../helpers';

const dialect = new PgDialect();
function renderSql(query: SQL): { sql: string; params: unknown[] } {
  const built = dialect.sqlToQuery(query);
  return { sql: built.sql, params: built.params };
}

vi.mock('../../../src/services/contract', () => ({
  contractSubmitBid: vi.fn().mockResolvedValue('0xbidtx'),
  contractSelectLowestBidder: vi.fn().mockResolvedValue('0xselecttx'),
  contractAcceptAuction: vi.fn().mockResolvedValue('0xaccepttx'),
  contractRefundOrphanedPayment: vi.fn().mockResolvedValue('0xrefundorphanhash'),
}));

vi.mock('../../../src/config/env', () => ({
  getServerConfig: vi.fn().mockReturnValue({
    BACKEND_URL: 'http://localhost:3000',
    CHAIN_ID: 84532,
    CONTRACT_ADDRESS: '0xD17485087c2d31bf5562ACf0C5295111982A1CBF',
    DEFAULT_PLATFORM_FEE_BPS: 500,
    ERC8004_IDENTITY_REGISTRY: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  }),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    recoverMessageAddress: vi.fn(),
  };
});

import { bidsRouter } from '../../../src/routers/bids.router';
import {
  contractSubmitBid,
  contractSelectLowestBidder,
  contractAcceptAuction,
  contractRefundOrphanedPayment,
} from '../../../src/services/contract';
import { recoverMessageAddress } from 'viem';
import { bids as bidsTable, orphanedPayments, tasks as tasksTable } from '../../../src/db/schema';

const WORKER = '0xWorker0000000000000000000000000000000001';
const WORKER_B = '0xWorkerB000000000000000000000000000000002';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const BID_ID = '00000000-0000-0000-0000-000000000001';
const ACCEPT_INPUT = { taskId: TASK_ID };

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    requester: '0xRequester',
    requesterPubkey: '0xRequester',
    description: 'Auction task',
    reward: '5000000',
    maxPrice: '5000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(Date.now() - 3600000), // 1 hour ago
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    mode: 'auction',
    taskVisibility: 'public',
    stakeRequired: 0,
    stakeBps: 0,
    pitchDeadline: null,
    bidDeadline: new Date(Date.now() + 3600000), // 1 hour from now
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
    auctionType: 'english',
    auctionStartPrice: null,
    auctionFloorPrice: null,
    requesterAgentId: null,
    ...overrides,
  };
}

describe('bids router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submit', () => {
    const submitInput = { taskId: TASK_ID, price: '3000000' };

    it('throws when worker address (payer) is missing', async () => {
      const ctx = createIntentCtx(); // no payer
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Worker address required');
    });

    it('throws when task not found', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not auction', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Not an Auction task');
    });

    it('throws when task is not open', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'claimed' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not open for bids');
    });

    it('throws when bid deadline has passed', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ bidDeadline: new Date(Date.now() - 1000) })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Bid deadline has passed');
    });

    it('throws when bid price exceeds max price', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ maxPrice: '5000000' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit({ taskId: TASK_ID, price: '6000000' })).rejects.toThrow(
        'Bid exceeds max price'
      );
    });

    it('throws for dutch auction type — use auction-accept instead', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ auctionType: 'dutch' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('auction-accept');
    });

    it('throws for reverse_dutch auction type — use auction-accept instead', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ auctionType: 'reverse_dutch' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('auction-accept');
    });

    it('throws for english when bid does not undercut current lowest', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'english' })]))
        // Lowest bid is at 3000000 — same price should be rejected
        .mockReturnValueOnce(
          makeChain([
            {
              id: 'b1',
              taskId: TASK_ID,
              workerAddress: WORKER_B,
              price: '3000000',
              createdAt: new Date(),
            },
          ])
        )
        .mockReturnValueOnce(makeChain([])); // existing bid for worker

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('undercut');
    });

    it('submits english bid successfully when price undercuts current lowest', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'english' })]))
        // Current lowest is 3000000 — new bid at 2000000 should succeed
        .mockReturnValueOnce(
          makeChain([
            {
              id: 'b1',
              taskId: TASK_ID,
              workerAddress: WORKER_B,
              price: '3000000',
              createdAt: new Date(),
            },
          ])
        );
      // linkIntentToBroadcast's outbox lookup, then the read-back that names the row that
      // actually persisted -- a re-bid or the indexer may already hold this (task, worker).
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ id: BID_ID }]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.submit({ taskId: TASK_ID, price: '2000000' });

      expect(result.success).toBe(true);
      expect(contractSubmitBid).toHaveBeenCalledOnce();
      expect(ctx.insertChain(bidsTable).values).toHaveBeenCalledOnce();
    });

    it('rejects reverse_english re-bid when price is not lower than own previous', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'reverse_english' })]))
        // existing bid at 2500000 — same price should be rejected
        .mockReturnValueOnce(
          makeChain([
            {
              id: 'b1',
              taskId: TASK_ID,
              workerAddress: WORKER,
              price: '2500000',
              createdAt: new Date(),
            },
          ])
        );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit({ taskId: TASK_ID, price: '3000000' })).rejects.toThrow(
        'Re-bid must be lower'
      );
    });

    it('submits reverse_english sealed bid successfully (no prior bid)', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'reverse_english' })]))
        .mockReturnValueOnce(makeChain([])); // no existing bid — skip english lowest check
      // linkIntentToBroadcast's outbox lookup, then the read-back that names the row that
      // actually persisted -- a re-bid or the indexer may already hold this (task, worker).
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ id: BID_ID }]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(contractSubmitBid).toHaveBeenCalledOnce();
    });

    it('submits bid successfully on happy path (english, no prior bids)', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()])).mockReturnValueOnce(makeChain([])); // no current lowest (empty bids)
      // linkIntentToBroadcast's outbox lookup, then the read-back that names the row that
      // actually persisted -- a re-bid or the indexer may already hold this (task, worker).
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ id: BID_ID }]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(typeof result.bidId).toBe('string');
      expect(contractSubmitBid).toHaveBeenCalledOnce();
      expect(ctx.insertChain(bidsTable).values).toHaveBeenCalledOnce();
    });

    // Verifies: ADR-0048
    it('never inserts a phantom bid row, and never refunds, when the on-chain submit fails', async () => {
      // A bid that was never placed on chain must not be upserted into the DB, or it could
      // win the auction. Whether the payment is orphaned is settlement's call from the
      // reconciler's confirmed verdict, not this handler's from any error at all.
      (contractSubmitBid as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Contract call rejected: BidExceedsMaxPrice')
      );
      const ctx = createIntentCtx(WORKER);
      ctx.res.locals.paymentTxHash = '0xpaymenttxhash';
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()])).mockReturnValueOnce(makeChain([])); // no current lowest

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow(/BidExceedsMaxPrice/);

      expect(contractRefundOrphanedPayment).not.toHaveBeenCalled();
      const insertedTables = ctx.db.insert.mock.calls.map(([table]: [unknown]) => table);
      expect(insertedTables).not.toContain(bidsTable);
      expect(insertedTables).not.toContain(orphanedPayments);
      expect(ctx.intents[0]!.status).toBe('recorded');
    });

    it('upserts on conflict with the indexer instead of failing on a duplicate (taskId, worker)', async () => {
      // services/indexer.ts's processBidSubmittedEvent reconciles the same on-chain
      // BidSubmitted event with its own insert (onConflictDoNothing on its side) and can
      // win the race against this handler's write for a worker's first bid on a task.
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()])).mockReturnValueOnce(makeChain([])); // no current lowest
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ id: BID_ID }]));
      const bidInsert = ctx.insertChain(bidsTable);

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(result.bidId).toBe(BID_ID);
      expect(bidInsert.onConflictDoUpdate).toHaveBeenCalledOnce();
      const [{ target, set }] = vi.mocked(bidInsert.onConflictDoUpdate).mock.calls[0];
      expect(target).toEqual([bidsTable.taskId, bidsTable.workerAddress]);
      expect(set).toEqual(expect.objectContaining({ price: submitInput.price }));
    });

    describe('private task authorization', () => {
      const PRIVATE_REQUESTER = '0xPrivateRequester00000000000000000000009';
      const privateTask = makeTask({ taskVisibility: 'private', requester: PRIVATE_REQUESTER });

      it('rejects an outsider who only holds a taskAccessGrant (view-only) with FORBIDDEN', async () => {
        // A taskAccessGrant is a bearer credential minted by taskAccess.verifyPassword
        // for VIEWING a private task -- it must never be sufficient to place a bid.
        // WORKER here has no allowlist/award/requester standing on this task.
        const ctx = createIntentCtx(WORKER, undefined, { taskId: TASK_ID });
        ctx.db.select
          .mockReturnValueOnce(makeChain([privateTask])) // task lookup
          .mockReturnValueOnce(makeChain([])) // allowlist (task_allowed_viewers) — empty
          .mockReturnValueOnce(makeChain([])); // awards (task_awards) — empty

        const caller = bidsRouter.createCaller(ctx);
        await expect(caller.submit(submitInput)).rejects.toThrow(
          'Not authorized to bid on this private task'
        );
        expect(contractSubmitBid).not.toHaveBeenCalled();
      });

      it('allows an allowlisted wallet address to bid on a private task', async () => {
        const ctx = createIntentCtx(WORKER);
        ctx.db.select
          .mockReturnValueOnce(makeChain([privateTask])) // task lookup
          .mockReturnValueOnce(makeChain([{ viewerAddress: WORKER }])) // allowlist contains WORKER
          .mockReturnValueOnce(makeChain([])) // awards — empty
          .mockReturnValueOnce(makeChain([])); // no current lowest bid (english)
        // linkIntentToBroadcast's outbox lookup, then the read-back that names the row that
      // actually persisted -- a re-bid or the indexer may already hold this (task, worker).
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ id: BID_ID }]));

        const caller = bidsRouter.createCaller(ctx);
        const result = await caller.submit(submitInput);

        expect(result.success).toBe(true);
        expect(contractSubmitBid).toHaveBeenCalledOnce();
      });

      it('allows the task requester to bid on their own private task', async () => {
        const requesterAsWorker = PRIVATE_REQUESTER;
        const ctx = createIntentCtx(requesterAsWorker);
        ctx.db.select
          .mockReturnValueOnce(makeChain([privateTask])) // task lookup
          .mockReturnValueOnce(makeChain([])) // allowlist — empty
          .mockReturnValueOnce(makeChain([])) // awards — empty
          .mockReturnValueOnce(makeChain([])); // no current lowest bid (english)
        // linkIntentToBroadcast's outbox lookup, then the read-back that names the row that
      // actually persisted -- a re-bid or the indexer may already hold this (task, worker).
      ctx.db.select
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ id: BID_ID }]));

        const caller = bidsRouter.createCaller(ctx);
        const result = await caller.submit({ taskId: TASK_ID, price: '3000000' });

        expect(result.success).toBe(true);
        expect(contractSubmitBid).toHaveBeenCalledOnce();
      });
    });
  });

  describe('listByTask', () => {
    it('returns bids sorted by price ascending', async () => {
      const ctx = createIntentCtx();
      // task query
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()])).mockReturnValueOnce(
        makeChain([
          {
            id: 'bid-2',
            taskId: TASK_ID,
            workerAddress: WORKER_B,
            price: '3000000',
            createdAt: new Date(),
          },
          {
            id: 'bid-1',
            taskId: TASK_ID,
            workerAddress: WORKER,
            price: '4000000',
            createdAt: new Date(),
          },
        ])
      );

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(2);
      expect(result[0].price).toBe('3000000');
      expect(result[1].price).toBe('4000000');
    });

    it('returns empty array when no bids exist', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()])).mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(0);
    });

    it('seals bids for reverse_english before deadline', async () => {
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'reverse_english' })]))
        .mockReturnValueOnce(
          makeChain([
            {
              id: 'bid-1',
              taskId: TASK_ID,
              workerAddress: WORKER,
              price: '3000000',
              createdAt: new Date(),
            },
          ])
        );

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(1);
      expect(result[0].price).toBeNull();
      expect(result[0].workerAddress).toBeNull();
    });

    it('reveals bids for reverse_english after deadline', async () => {
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            makeTask({ auctionType: 'reverse_english', bidDeadline: new Date(Date.now() - 1000) }),
          ])
        )
        .mockReturnValueOnce(
          makeChain([
            {
              id: 'bid-1',
              taskId: TASK_ID,
              workerAddress: WORKER,
              price: '3000000',
              createdAt: new Date(),
            },
          ])
        )
        // agent lookup
        .mockReturnValueOnce(makeChain([{ agentId: 'agent-1' }]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(1);
      expect(result[0].price).toBe('3000000');
      expect(result[0].workerAddress).toBe(WORKER);
    });
  });

  describe('selectWinner', () => {
    const selectInput = { taskId: TASK_ID };

    it('throws when task not found', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow('Task not found');
    });

    it('throws when task is not auction mode', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow('Not an Auction task');
    });

    it('throws when bid deadline has not passed', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ bidDeadline: new Date(Date.now() + 3600000) })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow(
        'Bid deadline has not passed yet'
      );
    });

    it('throws for dutch auctions — use auction-accept instead', async () => {
      const ctx = createIntentCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ auctionType: 'dutch', bidDeadline: new Date(Date.now() - 1000) })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow('auction-accept');
    });

    it('throws when no bids exist', async () => {
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ bidDeadline: new Date(Date.now() - 1000) })]))
        .mockReturnValueOnce(makeChain([])); // no bids

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow('No bids found');
    });

    it('assigns lowest bidder and returns their address', async () => {
      const ctx = createIntentCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ bidDeadline: new Date(Date.now() - 1000) })]))
        .mockReturnValueOnce(
          makeChain([
            {
              id: BID_ID,
              taskId: TASK_ID,
              workerAddress: WORKER_B,
              price: '3000000',
              createdAt: new Date(),
            },
          ])
        );

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.selectWinner(selectInput);

      expect(result.success).toBe(true);
      expect(result.workerAddress).toBe(WORKER_B);
      expect(contractSelectLowestBidder).toHaveBeenCalledOnce();
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });

    describe('wallet-signed auth (optional)', () => {
      const REQUESTER = '0xRequester0000000000000000000000000000099';
      const taskFromRequester = makeTask({
        requester: REQUESTER,
        bidDeadline: new Date(Date.now() - 1000),
      });

      it('succeeds when signature recovers to the task requester', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(REQUESTER as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(makeChain([taskFromRequester])).mockReturnValueOnce(
          makeChain([
            {
              id: BID_ID,
              taskId: TASK_ID,
              workerAddress: WORKER_B,
              price: '3000000',
              createdAt: new Date(),
            },
          ])
        );

        const caller = bidsRouter.createCaller(ctx);
        const result = await caller.selectWinner({
          taskId: TASK_ID,
          requesterAddress: REQUESTER,
          signature: '0xsig',
        });

        expect(result.success).toBe(true);
        expect(result.workerAddress).toBe(WORKER_B);
      });

      it('rejects when signature does not match requesterAddress', async () => {
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(
          '0xOther000000000000000000000000000000000001' as `0x${string}`
        );
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(makeChain([taskFromRequester]));

        const caller = bidsRouter.createCaller(ctx);
        await expect(
          caller.selectWinner({
            taskId: TASK_ID,
            requesterAddress: REQUESTER,
            signature: '0xsig',
          })
        ).rejects.toThrow('Signature does not match requester address');
      });

      it('rejects when requesterAddress is not the task requester', async () => {
        const SOMEONE_ELSE = '0xSomeoneElse0000000000000000000000000000007';
        vi.mocked(recoverMessageAddress).mockResolvedValueOnce(SOMEONE_ELSE as `0x${string}`);
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(makeChain([taskFromRequester]));

        const caller = bidsRouter.createCaller(ctx);
        await expect(
          caller.selectWinner({
            taskId: TASK_ID,
            requesterAddress: SOMEONE_ELSE,
            signature: '0xsig',
          })
        ).rejects.toThrow('Only the task requester can select the winner');
      });

      it('rejects when requesterAddress is provided without a signature', async () => {
        const ctx = createIntentCtx();
        ctx.db.select.mockReturnValueOnce(makeChain([taskFromRequester]));

        const caller = bidsRouter.createCaller(ctx);
        await expect(
          caller.selectWinner({ taskId: TASK_ID, requesterAddress: REQUESTER })
        ).rejects.toThrow('Both requesterAddress and signature must be provided together');
      });
    });
  });

  describe('auctionAccept', () => {
    it('throws when worker address missing', async () => {
      const ctx = createIntentCtx(); // no payer
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ auctionType: 'dutch' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('Worker address required');
    });

    it('throws when task not found', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not auction', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ mode: 'bounty', auctionType: null })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('Not an auction task');
    });

    it('throws when auction type is english (not clock-based)', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ auctionType: 'english' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow(
        'auction-accept is only for dutch'
      );
    });

    it('throws when deadline has passed', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ auctionType: 'dutch', bidDeadline: new Date(Date.now() - 1000) })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('expired');
    });

    it('throws when minPrice guard rejects clock price', async () => {
      const ctx = createIntentCtx(WORKER);
      // Dutch auction: clock descends from 5000000 over 2 hours, 1h elapsed = ~2500000 current
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            auctionType: 'dutch',
            maxPrice: '5000000',
            auctionFloorPrice: '0',
            createdAt: new Date(Date.now() - 3600000),
            bidDeadline: new Date(Date.now() + 3600000),
          }),
        ])
      );

      const caller = bidsRouter.createCaller(ctx);
      // minPrice of 4000000 — current price ~2500000 is below minimum
      await expect(caller.auctionAccept({ taskId: TASK_ID, minPrice: '4000000' })).rejects.toThrow(
        'below your minimum'
      );
    });

    it('accepts dutch clock auction — sets task to claimed atomically', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            auctionType: 'dutch',
            maxPrice: '5000000',
            auctionFloorPrice: '1000000',
            createdAt: new Date(Date.now() - 3600000),
            bidDeadline: new Date(Date.now() + 3600000),
          }),
        ])
      );
      // update().set().where().returning() returns 1 row = claimed successfully
      ctx.seedUpdate(tasksTable, [{ id: TASK_ID }]);

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);

      expect(result.success).toBe(true);
      expect(typeof result.acceptedPrice).toBe('string');
      expect(result.workerAddress).toBe(WORKER);
      expect(contractAcceptAuction).toHaveBeenCalledOnce();
      expect(ctx.insertChain(bidsTable).values).toHaveBeenCalledOnce(); // bid recorded
    });

    // Verifies: ADR-0045
    it('still records the accept when the task row was already moved on', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ auctionType: 'dutch', maxPrice: '5000000' })])
      );
      // The conditional claim matches nothing: the indexer processed the same on-chain
      // accept first. The chain has already named this worker, so the completion says so
      // rather than failing and stranding the intent.
      ctx.seedUpdate(tasksTable, []);

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);

      expect(result.success).toBe(true);
      expect(ctx.insertChain(bidsTable).values).toHaveBeenCalledOnce();
    });

    it('accepts reverse_dutch clock auction', async () => {
      const ctx = createIntentCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            auctionType: 'reverse_dutch',
            maxPrice: '5000000',
            auctionStartPrice: '1000000',
            auctionFloorPrice: null,
            createdAt: new Date(Date.now() - 3600000),
            bidDeadline: new Date(Date.now() + 3600000),
          }),
        ])
      );
      // Seeded per table rather than "the first UPDATE": that is now the intent's broadcast
      // claim (ADR-0052).
      ctx.seedUpdate(tasksTable, [{ id: TASK_ID }]);

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);

      expect(result.success).toBe(true);
      // At ~50% progress: startPrice + ~50% * (maxPrice - startPrice) ≈ 3000000
      expect(Number(result.acceptedPrice)).toBeGreaterThanOrEqual(3000000);
      expect(Number(result.acceptedPrice)).toBeLessThan(3050000);
    });

    describe('private task authorization', () => {
      const PRIVATE_REQUESTER = '0xPrivateRequester00000000000000000000009';
      const privateDutchTask = makeTask({
        taskVisibility: 'private',
        requester: PRIVATE_REQUESTER,
        auctionType: 'dutch',
        maxPrice: '5000000',
        auctionFloorPrice: '1000000',
        createdAt: new Date(Date.now() - 3600000),
        bidDeadline: new Date(Date.now() + 3600000),
      });

      it('rejects an outsider who only holds a taskAccessGrant (view-only) with FORBIDDEN', async () => {
        // A taskAccessGrant is a bearer credential minted by taskAccess.verifyPassword
        // for VIEWING a private task -- it must never be sufficient to claim a dutch/
        // reverse_dutch auction. WORKER here has no allowlist/award/requester standing.
        const ctx = createIntentCtx(WORKER, undefined, { taskId: TASK_ID });
        ctx.db.select
          .mockReturnValueOnce(makeChain([privateDutchTask])) // task lookup
          .mockReturnValueOnce(makeChain([])) // allowlist (task_allowed_viewers) — empty
          .mockReturnValueOnce(makeChain([])); // awards (task_awards) — empty

        const caller = bidsRouter.createCaller(ctx);
        await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow(
          'Not authorized to accept this private task'
        );
        expect(contractAcceptAuction).not.toHaveBeenCalled();
      });

      it('allows an allowlisted wallet address to accept a private dutch auction task', async () => {
        const ctx = createIntentCtx(WORKER);
        ctx.db.select
          .mockReturnValueOnce(makeChain([privateDutchTask])) // task lookup
          .mockReturnValueOnce(makeChain([{ viewerAddress: WORKER }])) // allowlist contains WORKER
          .mockReturnValueOnce(makeChain([])); // awards — empty
        // Seeded per table rather than "the first UPDATE": that is now the intent's broadcast
      // claim (ADR-0052).
      ctx.seedUpdate(tasksTable, [{ id: TASK_ID }]);

        const caller = bidsRouter.createCaller(ctx);
        const result = await caller.auctionAccept(ACCEPT_INPUT);

        expect(result.success).toBe(true);
        expect(contractAcceptAuction).toHaveBeenCalledOnce();
      });

      it('allows the task requester to accept their own private reverse_dutch auction task', async () => {
        const privateReverseDutchTask = makeTask({
          taskVisibility: 'private',
          requester: PRIVATE_REQUESTER,
          auctionType: 'reverse_dutch',
          maxPrice: '5000000',
          auctionStartPrice: '1000000',
          auctionFloorPrice: null,
          createdAt: new Date(Date.now() - 3600000),
          bidDeadline: new Date(Date.now() + 3600000),
        });
        const ctx = createIntentCtx(PRIVATE_REQUESTER);
        ctx.db.select
          .mockReturnValueOnce(makeChain([privateReverseDutchTask])) // task lookup
          .mockReturnValueOnce(makeChain([])) // allowlist — empty
          .mockReturnValueOnce(makeChain([])); // awards — empty
        // Seeded per table rather than "the first UPDATE": that is now the intent's broadcast
      // claim (ADR-0052).
      ctx.seedUpdate(tasksTable, [{ id: TASK_ID }]);

        const caller = bidsRouter.createCaller(ctx);
        const result = await caller.auctionAccept(ACCEPT_INPUT);

        expect(result.success).toBe(true);
        expect(contractAcceptAuction).toHaveBeenCalledOnce();
      });
    });
  });

  describe('computeClockPrice (via auctionAccept)', () => {
    it('dutch: at t=0 price equals maxPrice', async () => {
      const ctx = createIntentCtx(WORKER);
      const now = Date.now();
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            auctionType: 'dutch',
            maxPrice: '5000000',
            auctionFloorPrice: '1000000',
            createdAt: new Date(now), // just created
            bidDeadline: new Date(now + 3600000),
          }),
        ])
      );
      // Seeded per table rather than "the first UPDATE": that is now the intent's broadcast
      // claim (ADR-0052).
      ctx.seedUpdate(tasksTable, [{ id: TASK_ID }]);

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);

      // At t~0: price should be at or very close to maxPrice (5000000)
      expect(Number(result.acceptedPrice)).toBeGreaterThan(4990000);
    });

    it('dutch: near t=100% price is clamped to floorPrice', async () => {
      const ctx = createIntentCtx(WORKER);
      // createdAt 2h ago, bidDeadline 1s from now: elapsed / total ≈ 99.99%
      // bidDeadline must remain in the future for auctionAccept to not throw "expired"
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            auctionType: 'dutch',
            maxPrice: '5000000',
            auctionFloorPrice: '1000000',
            status: 'open',
            createdAt: new Date(Date.now() - 7200000), // 2h ago
            bidDeadline: new Date(Date.now() + 1000), // 1s from now
          }),
        ])
      );
      // Seeded per table rather than "the first UPDATE": that is now the intent's broadcast
      // claim (ADR-0052).
      ctx.seedUpdate(tasksTable, [{ id: TASK_ID }]);

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);
      // ~99.99% elapsed: price is near or at floorPrice; clamped to minimum 1000000
      expect(Number(result.acceptedPrice)).toBeGreaterThanOrEqual(1000000);
    });
  });

  describe('myBids', () => {
    const WORKER_HEX = `0x${'1'.repeat(40)}`;

    it('returns pending bids for ctx.caller (ADR-0016/ADR-0022 read-auth)', async () => {
      const ctx = createIntentCtx(undefined, { address: WORKER_HEX });
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          {
            taskId: TASK_ID,
            auctionType: 'english',
            bidDeadline: new Date('2026-01-01T00:00:00.000Z'),
            taskStatus: 'open',
            myBidPrice: '4000000',
            bidCount: 2,
            lowestBid: '3500000',
          },
        ])
      );

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.myBids({});

      expect(result).toEqual([
        {
          taskId: TASK_ID,
          auctionType: 'english',
          myBidPrice: '4000000',
          currentLowestBid: '3500000',
          bidDeadline: '2026-01-01T00:00:00.000Z',
          bidCount: 2,
          taskStatus: 'open',
        },
      ]);
    });

    it('matches bids.workerAddress case-insensitively against ctx.caller', async () => {
      const ctx = createIntentCtx(undefined, { address: WORKER_HEX });

      let whereSql: SQL | undefined;
      const chain = makeChain([]);
      chain.where = vi.fn((arg: SQL) => {
        whereSql = arg;
        return chain;
      });
      ctx.db.select.mockReturnValueOnce(chain);

      const caller = bidsRouter.createCaller(ctx);
      await caller.myBids({});

      expect(whereSql).toBeDefined();
      const { sql: q } = renderSql(whereSql!);
      expect(q.toLowerCase()).toContain('lower(');
    });

    it('rejects with UNAUTHORIZED when there is no caller (protectedProcedure, ADR-0017/ADR-0022)', async () => {
      const ctx = createIntentCtx(undefined, undefined);

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.myBids({})).rejects.toThrow('Caller authentication required');
    });
  });
});
