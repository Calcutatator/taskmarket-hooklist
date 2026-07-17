import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createMockCtx, makeChain } from '../helpers';

import { agentsRouter } from '../../../src/routers/agents.router';

const ADDR = '0xAgent00000000000000000000000000000000001';
const AGENT_ID = 'agent-001';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    address: ADDR,
    agentId: AGENT_ID,
    completedTasks: 20,
    ratedTasks: 10,
    totalStars: 800,
    totalEarnings: '5000000',
    skills: ['typescript', 'solidity'],
    emailAddress: null,
    registeredVia: 'cli',
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('agents router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stats', () => {
    it('returns zero stats when agent not found', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).stats({ address: ADDR });

      expect(result.completedTasks).toBe(0);
      expect(result.averageRating).toBe(0);
      expect(result.credibility).toBeUndefined();
    });

    it('returns stats with credibility for agent with rated tasks', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeAgent()]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).stats({ address: ADDR });

      expect(result.address).toBe(ADDR);
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.completedTasks).toBe(20);
      expect(result.averageRating).toBe(80);
      // credibility: floor(10 / (10 + 10) * 1000) = 500
      expect(result.credibility).toBe(500);
    });

    it('returns credibility 0 when no rated tasks', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeAgent({ ratedTasks: 0, totalStars: 0 })]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).stats({ address: ADDR });

      expect(result.credibility).toBe(0);
      expect(result.averageRating).toBe(0);
    });

    it('credibility approaches 1000 with many rated tasks', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeAgent({ ratedTasks: 990, totalStars: 79200 })]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).stats({ address: ADDR });

      // floor(990 / 1000 * 1000) = 990
      expect(result.credibility).toBe(990);
    });

    it('throws when neither address nor agentId provided', async () => {
      const ctx = createMockCtx();

      await expect(agentsRouter.createCaller(ctx).stats({})).rejects.toThrow(
        'Provide address or agentId'
      );
    });

    it('looks up by agentId when provided', async () => {
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeAgent()]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).stats({ agentId: AGENT_ID });

      expect(result.agentId).toBe(AGENT_ID);
    });
  });

  describe('leaderboard', () => {
    it('returns ranked agents with credibility', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(
        makeChain([
          makeAgent({ completedTasks: 50, ratedTasks: 20, totalStars: 1600 }),
          makeAgent({
            address: '0xAgent00000000000000000000000000000000002',
            agentId: 'agent-002',
            completedTasks: 30,
            ratedTasks: 5,
            totalStars: 400,
          }),
        ])
      );

      const result = await agentsRouter.createCaller(ctx).leaderboard({
        sort: 'reputation',
        limit: 10,
        offset: 0,
      });

      expect(result).toHaveLength(2);
      expect(result[0].rank).toBe(1);
      expect(result[1].rank).toBe(2);
      // credibility for ratedTasks=20: floor(20/30 * 1000) = 666
      expect(result[0].credibility).toBe(666);
      // credibility for ratedTasks=5: floor(5/15 * 1000) = 333
      expect(result[1].credibility).toBe(333);
    });

    it('returns empty array when no agents match', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).leaderboard({
        sort: 'tasks',
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual([]);
    });

    it('applies offset to rank numbers', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([makeAgent()]));

      const result = await agentsRouter.createCaller(ctx).leaderboard({
        sort: 'reputation',
        limit: 10,
        offset: 5,
      });

      expect(result[0].rank).toBe(6);
    });
  });

  describe('inbox', () => {
    it('discovers worker tasks through award membership', async () => {
      const requesterChain = makeChain([]);
      const workerChain = makeChain([]);
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(requesterChain)
        .mockReturnValueOnce(workerChain);

      await agentsRouter.createCaller(ctx).inbox({ address: ADDR });

      const where = workerChain.where.mock.calls[0]?.[0];
      const query = new PgDialect().sqlToQuery(where);
      expect(query.sql).toContain('from "task_awards"');
      expect(query.sql).toContain('lower("task_awards"."worker_address")');
    });
  });
});
