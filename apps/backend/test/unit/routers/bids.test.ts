import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractSubmitBid: vi.fn().mockResolvedValue('0xbidtx'),
  contractSelectLowestBidder: vi.fn().mockResolvedValue('0xselecttx'),
}));

import { bidsRouter } from '../../../src/routers/bids.router';
import { contractSubmitBid, contractSelectLowestBidder } from '../../../src/services/contract';

const WORKER = '0xWorker0000000000000000000000000000000001';
const WORKER_B = '0xWorkerB000000000000000000000000000000002';
const TASK_ID = '0xtask0000000000000000000000000000000001';
const BID_ID = '00000000-0000-0000-0000-000000000001';

function makeTask(overrides: Record<string, any> = {}) {
  return {
    id: TASK_ID,
    requester: '0xRequester',
    requesterPubkey: '0xRequester',
    description: 'Auction task',
    reward: '5000000',
    maxPrice: '5000000',
    escrowTxHash: '0xhash',
    createdAt: new Date(),
    expiryTime: new Date(Date.now() + 86400000),
    status: 'open',
    tags: [],
    worker: null,
    rating: null,
    mode: 'auction',
    stakeRequired: 0,
    stakeBps: 0,
    pitchDeadline: null,
    bidDeadline: new Date(Date.now() + 3600000),
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
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

    it('submits bid successfully on happy path', async () => {
      const ctx = createMockCtx(WORKER);
      ctx.db.select.mockReturnValueOnce(makeChain([makeTask()]));

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
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          { id: 'bid-2', taskId: TASK_ID, workerAddress: WORKER_B, price: '3000000', createdAt: new Date() },
          { id: 'bid-1', taskId: TASK_ID, workerAddress: WORKER, price: '4000000', createdAt: new Date() },
        ])
      );

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(2);
      // DB orderBy is mocked; just verify shape
      expect(result[0].price).toBe('3000000');
      expect(result[1].price).toBe('4000000');
    });

    it('returns empty array when no bids exist', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const caller = bidsRouter.createCaller(ctx);
      const result = await caller.listByTask({ taskId: TASK_ID });

      expect(result).toHaveLength(0);
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
});
