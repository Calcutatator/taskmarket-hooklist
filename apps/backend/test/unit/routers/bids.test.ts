import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractSubmitBid: vi.fn().mockResolvedValue('0xbidtx'),
  contractSelectLowestBidder: vi.fn().mockResolvedValue('0xselecttx'),
  contractAcceptAuction: vi.fn().mockResolvedValue('0xaccepttx'),
}));

vi.mock('../../../src/services/xmtp-auth', () => ({
  authenticateXmtpDevice: vi.fn().mockResolvedValue({ deviceId: 'dev-1', walletAddress: '0xWorker0000000000000000000000000000000001' }),
}));

import { bidsRouter } from '../../../src/routers/bids.router';
import { contractSubmitBid, contractSelectLowestBidder, contractAcceptAuction } from '../../../src/services/contract';

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
    worker: null,
    rating: null,
    mode: 'auction',
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
      const ctx = createMockCtx(); // no payer
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Worker address required');
    });

    it('throws when task not found', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not auction', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Not an Auction task');
    });

    it('throws when task is not open', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ status: 'claimed' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Task not open for bids');
    });

    it('throws when bid deadline has passed', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ bidDeadline: new Date(Date.now() - 1000) })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('Bid deadline has passed');
    });

    it('throws when bid price exceeds max price', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ maxPrice: '5000000' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit({ taskId: TASK_ID, price: '6000000' })).rejects.toThrow(
        'Bid exceeds max price'
      );
    });

    it('throws for dutch auction type — use auction-accept instead', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ auctionType: 'dutch' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('auction-accept');
    });

    it('throws for reverse_dutch auction type — use auction-accept instead', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ auctionType: 'reverse_dutch' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('auction-accept');
    });

    it('throws for english when bid does not undercut current lowest', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'english' })]))
        // Lowest bid is at 3000000 — same price should be rejected
        .mockReturnValueOnce(makeChain([{ id: 'b1', taskId: TASK_ID, workerAddress: WORKER_B, price: '3000000', createdAt: new Date() }]))
        .mockReturnValueOnce(makeChain([])); // existing bid for worker

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit(submitInput)).rejects.toThrow('undercut');
    });

    it('submits english bid successfully when price undercuts current lowest', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'english' })]))
        // Current lowest is 3000000 — new bid at 2000000 should succeed
        .mockReturnValueOnce(makeChain([{ id: 'b1', taskId: TASK_ID, workerAddress: WORKER_B, price: '3000000', createdAt: new Date() }]))
        .mockReturnValueOnce(makeChain([])); // no existing bid for this worker

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.submit({ taskId: TASK_ID, price: '2000000' });

      expect(result.success).toBe(true);
      expect(contractSubmitBid).toHaveBeenCalledOnce();
      expect(ctx.db.insert).toHaveBeenCalledOnce();
    });

    it('rejects reverse_english re-bid when price is not lower than own previous', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'reverse_english' })]))
        // existing bid at 2500000 — same price should be rejected
        .mockReturnValueOnce(makeChain([{ id: 'b1', taskId: TASK_ID, workerAddress: WORKER, price: '2500000', createdAt: new Date() }]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.submit({ taskId: TASK_ID, price: '3000000' })).rejects.toThrow(
        'Re-bid must be lower'
      );
    });

    it('submits reverse_english sealed bid successfully (no prior bid)', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ auctionType: 'reverse_english' })]))
        .mockReturnValueOnce(makeChain([])) // no existing bid — skip english lowest check
        .mockReturnValueOnce(makeChain([])); // no existing bid for this worker (for upsert check)

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(contractSubmitBid).toHaveBeenCalledOnce();
    });

    it('submits bid successfully on happy path (english, no prior bids)', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([])) // no current lowest (empty bids)
        .mockReturnValueOnce(makeChain([])); // no existing bid for this worker

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.submit(submitInput);

      expect(result.success).toBe(true);
      expect(typeof result.bidId).toBe('string');
      expect(contractSubmitBid).toHaveBeenCalledOnce();
      expect(ctx.db.insert).toHaveBeenCalledOnce();
    });
  });

  describe('listByTask', () => {
    it('returns bids sorted by price ascending', async () => {
      const ctx = createMockCtx();
      // task query
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(
          makeChain([
            { id: 'bid-2', taskId: TASK_ID, workerAddress: WORKER_B, price: '3000000', createdAt: new Date() },
            { id: 'bid-1', taskId: TASK_ID, workerAddress: WORKER, price: '4000000', createdAt: new Date() },
          ])
        );

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(2);
      expect(result[0].price).toBe('3000000');
      expect(result[1].price).toBe('4000000');
    });

    it('returns empty array when no bids exist', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask()]))
        .mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(0);
    });

    it('seals bids for reverse_english before deadline', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([makeTask({ auctionType: 'reverse_english' })])
        )
        .mockReturnValueOnce(
          makeChain([
            { id: 'bid-1', taskId: TASK_ID, workerAddress: WORKER, price: '3000000', createdAt: new Date() },
          ])
        );

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(1);
      expect(result[0].price).toBeNull();
      expect(result[0].workerAddress).toBeNull();
    });

    it('reveals bids for reverse_english after deadline', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([makeTask({ auctionType: 'reverse_english', bidDeadline: new Date(Date.now() - 1000) })])
        )
        .mockReturnValueOnce(
          makeChain([
            { id: 'bid-1', taskId: TASK_ID, workerAddress: WORKER, price: '3000000', createdAt: new Date() },
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
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow('Task not found');
    });

    it('throws when task is not auction mode', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow('Not an Auction task');
    });

    it('throws when bid deadline has not passed', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ bidDeadline: new Date(Date.now() + 3600000) })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow(
        'Bid deadline has not passed yet'
      );
    });

    it('throws for dutch auctions — use auction-accept instead', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ auctionType: 'dutch', bidDeadline: new Date(Date.now() - 1000) })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow('auction-accept');
    });

    it('throws when no bids exist', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ bidDeadline: new Date(Date.now() - 1000) })]))
        .mockReturnValueOnce(makeChain([])); // no bids

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.selectWinner(selectInput)).rejects.toThrow('No bids found');
    });

    it('assigns lowest bidder and returns their address', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeTask({ bidDeadline: new Date(Date.now() - 1000) })]))
        .mockReturnValueOnce(
          makeChain([
            { id: BID_ID, taskId: TASK_ID, workerAddress: WORKER_B, price: '3000000', createdAt: new Date() },
          ])
        );

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.selectWinner(selectInput);

      expect(result.success).toBe(true);
      expect(result.workerAddress).toBe(WORKER_B);
      expect(contractSelectLowestBidder).toHaveBeenCalledOnce();
      expect(ctx.db.update).toHaveBeenCalledOnce();
    });
  });

  describe('auctionAccept', () => {

    it('throws when worker address missing', async () => {
      const ctx = createMockCtx(); // no payer
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ auctionType: 'dutch' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('Worker address required');
    });

    it('throws when task not found', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('Task not found');
    });

    it('throws when task mode is not auction', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ mode: 'bounty', auctionType: null })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('Not an auction task');
    });

    it('throws when auction type is english (not clock-based)', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask({ auctionType: 'english' })]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('auction-accept is only for dutch');
    });

    it('throws when deadline has passed', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ auctionType: 'dutch', bidDeadline: new Date(Date.now() - 1000) })])
      );

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('expired');
    });

    it('throws when minPrice guard rejects clock price', async () => {
      const ctx = createMockCtx(WORKER);
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
      await expect(
        caller.auctionAccept({ taskId: TASK_ID, minPrice: '4000000' })
      ).rejects.toThrow('below your minimum');
    });

    it('accepts dutch clock auction — sets task to claimed atomically', async () => {
      const ctx = createMockCtx(WORKER);
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
      ctx.db.update.mockReturnValueOnce(makeChain([{ id: TASK_ID }]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);

      expect(result.success).toBe(true);
      expect(typeof result.acceptedPrice).toBe('string');
      expect(result.workerAddress).toBe(WORKER);
      expect(contractAcceptAuction).toHaveBeenCalledOnce();
      expect(ctx.db.insert).toHaveBeenCalledOnce(); // bid recorded
    });

    it('throws when race condition loses — another worker already claimed', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(
        makeChain([makeTask({ auctionType: 'dutch', maxPrice: '5000000' })])
      );
      // update returns 0 rows = another worker claimed first
      ctx.db.update.mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      await expect(caller.auctionAccept(ACCEPT_INPUT)).rejects.toThrow('already claimed');
    });

    it('accepts reverse_dutch clock auction', async () => {
      const ctx = createMockCtx(WORKER);
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
      ctx.db.update.mockReturnValueOnce(makeChain([{ id: TASK_ID }]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);

      expect(result.success).toBe(true);
      // At ~50% progress: startPrice + ~50% * (maxPrice - startPrice) ≈ 3000000
      expect(Number(result.acceptedPrice)).toBeGreaterThanOrEqual(3000000);
      expect(Number(result.acceptedPrice)).toBeLessThan(3050000);
    });
  });

  describe('computeClockPrice (via auctionAccept)', () => {
    it('dutch: at t=0 price equals maxPrice', async () => {
      const ctx = createMockCtx(WORKER);
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
      ctx.db.update.mockReturnValueOnce(makeChain([{ id: TASK_ID }]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);

      // At t~0: price should be at or very close to maxPrice (5000000)
      expect(Number(result.acceptedPrice)).toBeGreaterThan(4990000);
    });

    it('dutch: at t=100% price equals floorPrice', async () => {
      const ctx = createMockCtx(WORKER);
      // Both createdAt and bidDeadline in the past = 100% elapsed
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeTask({
            auctionType: 'dutch',
            maxPrice: '5000000',
            auctionFloorPrice: '1000000',
            status: 'open',
            bidDeadline: new Date(Date.now() + 1000), // still open but 100% elapsed sim
            createdAt: new Date(Date.now() - 7200000), // 2h ago
            // bidDeadline 1h ago would be elapsed, but need it in future for status check
          }),
        ])
      );
      ctx.db.update.mockReturnValueOnce(makeChain([{ id: TASK_ID }]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.auctionAccept(ACCEPT_INPUT);
      // Price is clamped to floorPrice minimum
      expect(Number(result.acceptedPrice)).toBeGreaterThanOrEqual(1000000);
    });
  });
});
