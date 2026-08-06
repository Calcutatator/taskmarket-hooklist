import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createMockCtx, makeChain } from '../helpers';

vi.mock('../../../src/services/contract', () => ({
  contractGetContestAppealState: vi.fn(),
}));

import { agentsRouter } from '../../../src/routers/agents.router';
import { contractGetContestAppealState } from '../../../src/services/contract';

const ADDR = '0xAgent00000000000000000000000000000000001';
const AGENT_ID = 'agent-001';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function makeActionQueueTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-action-1',
    requester: ADDR,
    requesterPubkey: null,
    description: 'Review submitted work',
    reward: '1000000',
    escrowTxHash: '0xescrow',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    expiryTime: new Date('2026-08-10T00:00:00.000Z'),
    status: 'open',
    tags: [],
    mode: 'bounty',
    taskVisibility: 'public',
    submissionVisibility: 'public',
    privateAccessPasswordHash: null,
    stakeRequired: 0,
    stakeBps: 0,
    pitchDeadline: null,
    bidDeadline: null,
    maxPrice: null,
    auctionType: null,
    auctionStartPrice: null,
    auctionFloorPrice: null,
    metricDescription: null,
    metricTarget: null,
    claimedBy: null,
    claimedAt: null,
    platformFeeBps: 500,
    requesterAgentId: null,
    selfAward: false,
    hookContract: null,
    evaluator: null,
    evaluatorStake: null,
    evaluatorFeeBps: null,
    evaluationWindow: null,
    appealWindow: null,
    disputeResolver: null,
    appealDeadline: null,
    verdictType: null,
    verdictScore: null,
    verdictConfidence: null,
    verdictEvidenceHash: null,
    evaluatorDeadline: null,
    taskDropId: null,
    ...overrides,
  };
}

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
    vi.useRealTimers();
    vi.mocked(contractGetContestAppealState).mockResolvedValue({
      claimedWorker: ZERO_ADDRESS,
      hasSubmission: false,
    });
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
      ctx.db.select.mockReturnValueOnce(requesterChain).mockReturnValueOnce(workerChain);

      await agentsRouter.createCaller(ctx).inbox({ address: ADDR });

      const where = workerChain.where.mock.calls[0]?.[0];
      const query = new PgDialect().sqlToQuery(where);
      expect(query.sql).toContain('from "task_awards"');
      expect(query.sql).toContain('lower("task_awards"."worker_address")');
    });

    it('excludes unlisted tasks by default (no read-auth header)', async () => {
      const requesterChain = makeChain([]);
      const workerChain = makeChain([]);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(requesterChain).mockReturnValueOnce(workerChain);

      await agentsRouter.createCaller(ctx).inbox({ address: ADDR });

      const requesterWhere = requesterChain.where.mock.calls[0]?.[0];
      const requesterQuery = new PgDialect().sqlToQuery(requesterWhere);
      expect(requesterQuery.sql).toContain('"tasks"."task_visibility" not in');

      const workerWhere = workerChain.where.mock.calls[0]?.[0];
      const workerQuery = new PgDialect().sqlToQuery(workerWhere);
      expect(workerQuery.sql).toContain('"tasks"."task_visibility" not in');
    });

    it('includes unlisted tasks when ctx.caller matches the queried address (ADR-0016/ADR-0022)', async () => {
      const requesterChain = makeChain([]);
      const workerChain = makeChain([]);
      const ctx = createMockCtx(undefined, { address: ADDR.toLowerCase() });
      ctx.db.select.mockReturnValueOnce(requesterChain).mockReturnValueOnce(workerChain);

      await agentsRouter.createCaller(ctx).inbox({ address: ADDR });

      const requesterWhere = requesterChain.where.mock.calls[0]?.[0];
      const requesterQuery = new PgDialect().sqlToQuery(requesterWhere);
      expect(requesterQuery.sql).not.toContain('visibility');

      const workerWhere = workerChain.where.mock.calls[0]?.[0];
      const workerQuery = new PgDialect().sqlToQuery(workerWhere);
      expect(workerQuery.sql).not.toContain('visibility');
    });

    it('does not unlock unlisted tasks when ctx.caller is a different address', async () => {
      const requesterChain = makeChain([]);
      const workerChain = makeChain([]);
      const ctx = createMockCtx(undefined, {
        address: '0x0000000000000000000000000000000000000001',
      });
      ctx.db.select.mockReturnValueOnce(requesterChain).mockReturnValueOnce(workerChain);

      await agentsRouter.createCaller(ctx).inbox({ address: ADDR });

      const requesterWhere = requesterChain.where.mock.calls[0]?.[0];
      const requesterQuery = new PgDialect().sqlToQuery(requesterWhere);
      expect(requesterQuery.sql).toContain('"tasks"."task_visibility" not in');
    });

    describe('invitedPrivateTasks (Phase 3, ADR-0030)', () => {
      function makeInvitedTask(overrides: Record<string, unknown> = {}) {
        return {
          id: 'task-private-1',
          requester: '0xRequester000000000000000000000000000001',
          requesterPubkey: null,
          description: 'A private task',
          reward: '1000000',
          escrowTxHash: '0xhash',
          createdAt: new Date(),
          expiryTime: new Date(Date.now() + 86400000),
          status: 'open',
          tags: [],
          mode: 'bounty',
          taskVisibility: 'private',
          submissionVisibility: 'public',
          stakeRequired: 0,
          stakeBps: 0,
          pitchDeadline: null,
          bidDeadline: null,
          maxPrice: null,
          metricDescription: null,
          metricTarget: null,
          claimedBy: null,
          claimedAt: null,
          platformFeeBps: 500,
          awardCount: 0,
          primaryAwardWorker: null,
          primaryAwardRating: null,
          ...overrides,
        };
      }

      it('never queries the invite join for a third party (not self-authed)', async () => {
        const ctx = createMockCtx();
        ctx.db.select
          .mockReturnValueOnce(makeChain([]))
          .mockReturnValueOnce(makeChain([]));

        const result = await agentsRouter.createCaller(ctx).inbox({ address: ADDR });

        expect(result.invitedPrivateTasks).toEqual([]);
        // Only 2 real query configurations were provided; if a third select() call
        // happened and consumed one of these by accident, one of the two branches
        // above would have received the wrong chain -- asserting exactly 2 calls
        // catches that regression directly.
        expect(ctx.db.select).toHaveBeenCalledTimes(2);
      });

      it('surfaces a private task the address was invited to, once self-authed', async () => {
        const invitedChain = makeChain([makeInvitedTask()]);
        const ctx = createMockCtx(undefined, { address: ADDR.toLowerCase() });
        ctx.db.select
          .mockReturnValueOnce(makeChain([])) // asRequester
          .mockReturnValueOnce(makeChain([])) // asWorker
          .mockReturnValueOnce(invitedChain) // invitedPrivateTasks join
          .mockReturnValueOnce(makeChain([])) // submissionCounts
          .mockReturnValueOnce(makeChain([])) // pitchCounts
          .mockReturnValueOnce(makeChain([])); // requesterKeys

        const result = await agentsRouter.createCaller(ctx).inbox({ address: ADDR });

        expect(result.invitedPrivateTasks).toHaveLength(1);
        expect(result.invitedPrivateTasks[0]!.id).toBe('task-private-1');
        expect(invitedChain.innerJoin).toHaveBeenCalled();

        const where = invitedChain.where.mock.calls[0]?.[0];
        const query = new PgDialect().sqlToQuery(where);
        expect(query.sql).toContain("tasks\".\"task_visibility\" = ");
        expect(query.params).toContain('private');
      });

      it('does not double-list an invited wallet that has since become the assigned worker', async () => {
        const sharedTask = makeInvitedTask({ id: 'task-private-2', claimedBy: ADDR.toLowerCase() });
        const ctx = createMockCtx(undefined, { address: ADDR.toLowerCase() });
        ctx.db.select
          .mockReturnValueOnce(makeChain([])) // asRequester
          .mockReturnValueOnce(makeChain([sharedTask])) // asWorker
          .mockReturnValueOnce(makeChain([sharedTask])) // invitedPrivateTasks (same task)
          .mockReturnValueOnce(makeChain([])) // submissionCounts
          .mockReturnValueOnce(makeChain([])) // pitchCounts
          .mockReturnValueOnce(makeChain([])); // requesterKeys

        const result = await agentsRouter.createCaller(ctx).inbox({ address: ADDR });

        expect(result.asWorker).toHaveLength(1);
        expect(result.invitedPrivateTasks).toHaveLength(0);
      });
    });
  });

  // Verifies: ADR-0041 (public queue grouping, role discovery, visibility, and batching)
  describe('actionQueue', () => {
    it('groups alternative review actions into one requester intent without task fan-out', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(makeChain([makeActionQueueTask()]))
        .mockReturnValueOnce(
          makeChain([
            {
              taskId: 'task-action-1',
              count: 2,
              distinctSubmitterCount: 2,
              onlySubmitter: null,
            },
          ])
        )
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result.total).toBe(1);
      expect(result.urgentTotal).toBe(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'task-action-1:review_work',
        intent: 'review_work',
        role: 'requester',
        priority: 'required',
        progress: { completed: 0, total: 2 },
      });
      expect(result.items[0]?.actions.map((item) => item.action)).toEqual([
        'accept',
        'accept_submissions',
        'reject_submission',
      ]);
      expect(ctx.db.select).toHaveBeenCalledTimes(5);
    });

    it('discovers public assigned roles without trusting anonymous submission membership', async () => {
      const candidateChain = makeChain([]);
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(candidateChain);

      await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      const where = candidateChain.where.mock.calls[0]?.[0];
      const query = new PgDialect().sqlToQuery(where);
      expect(query.sql).toContain('"tasks"."requester"');
      expect(query.sql).toContain('"tasks"."claimed_by"');
      expect(query.sql).toContain('"tasks"."evaluator"');
      expect(query.sql).toContain('"tasks"."dispute_resolver"');
      expect(query.sql).toContain('from "task_awards"');
      expect(query.sql).not.toContain('from "submissions"');
      expect(query.sql).toContain('"tasks"."task_visibility" not in');
      expect(query.sql).toContain('"tasks"."status" in');
      expect(query.params).toEqual(
        expect.arrayContaining([
          'open',
          'claimed',
          'worker_selected',
          'pending_approval',
          'review',
          'appealing',
          'disputed',
          'completed',
        ])
      );
      expect(query.params).not.toEqual(expect.arrayContaining(['expired', 'cancelled']));
      expect(query.sql).toContain('"task_awards"."rating" is null');
    });

    it.each(['never', 'reveal_all', 'winner_only'])(
      'does not infer anonymous victim membership from active %s submissions',
      async () => {
        const candidateChain = makeChain([]);
        const ctx = createMockCtx();
        ctx.db.select.mockReturnValueOnce(candidateChain);

        const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

        expect(result).toEqual({ items: [], total: 0, urgentTotal: 0, waiting: [] });
        const where = candidateChain.where.mock.calls[0]?.[0];
        const query = new PgDialect().sqlToQuery(where);
        expect(query.sql).not.toContain('from "submissions"');
      }
    );

    it('adds private and unlisted role tasks only after read-auth verifies the same address', async () => {
      const candidateChain = makeChain([]);
      const ctx = createMockCtx(undefined, { address: ADDR.toLowerCase() });
      ctx.db.select.mockReturnValueOnce(candidateChain);

      await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      const where = candidateChain.where.mock.calls[0]?.[0];
      const query = new PgDialect().sqlToQuery(where);
      expect(query.sql).toContain('from "submissions"');
      expect(query.sql).not.toContain('task_visibility');
    });

    it('filters a former private submitter after allowlist and password access are gone', async () => {
      const candidateChain = makeChain([
        makeActionQueueTask({
          requester: '0xRequester',
          taskVisibility: 'private',
          submissionVisibility: 'never',
        }),
      ]);
      const ctx = createMockCtx(undefined, { address: ADDR.toLowerCase() });
      ctx.db.select
        .mockReturnValueOnce(candidateChain)
        .mockReturnValueOnce(makeChain([])) // revoked allowlist
        .mockReturnValueOnce(makeChain([])); // no award membership

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result).toEqual({ items: [], total: 0, urgentTotal: 0, waiting: [] });
      expect(ctx.taskAccessGrant).toBeUndefined();
      expect(ctx.db.select).toHaveBeenCalledTimes(3);
    });

    it('prioritizes an assigned worker submission when its deadline is within 24 hours', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            makeActionQueueTask({
              id: 'task-worker',
              requester: '0xRequester',
              mode: 'claim',
              status: 'claimed',
              claimedBy: ADDR,
              expiryTime: new Date('2026-08-06T20:00:00.000Z'),
            }),
          ])
        )
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result).toMatchObject({ total: 1, urgentTotal: 1 });
      expect(result.items[0]).toMatchObject({
        id: 'task-worker:submit_work',
        role: 'worker',
        intent: 'submit_work',
        priority: 'urgent',
        dueAt: '2026-08-06T20:00:00.000Z',
      });
    });

    it('groups unrated recipients into one follow-up intent with aggregate progress', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([makeActionQueueTask({ id: 'task-rating', status: 'completed' })])
        )
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(
          makeChain([
            { taskId: 'task-rating', workerAddress: '0xWorkerA', rank: 1, rating: 90 },
            { taskId: 'task-rating', workerAddress: '0xWorkerB', rank: 2, rating: null },
          ])
        );

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'task-rating:rate_workers',
        intent: 'rate_workers',
        priority: 'follow_up',
        progress: { completed: 1, total: 2 },
      });
      expect(result.items[0]?.actions).toHaveLength(1);
      expect(result.items[0]?.actions[0]?.targetWorker).toBe('0xWorkerB');
    });

    it('does not duplicate a task when the same wallet holds requester and worker roles', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            makeActionQueueTask({
              id: 'task-self-role',
              mode: 'claim',
              status: 'claimed',
              claimedBy: ADDR,
            }),
          ])
        )
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        expect.objectContaining({ id: 'task-self-role:submit_work', role: 'worker' }),
      ]);
    });

    it('queues a contest appeal only for a wallet that actually submitted', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
      vi.mocked(contractGetContestAppealState).mockResolvedValueOnce({
        claimedWorker: ZERO_ADDRESS,
        hasSubmission: true,
      });
      const ctx = createMockCtx(undefined, { address: ADDR.toLowerCase() });
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            makeActionQueueTask({
              id: 'task-appeal',
              requester: '0xRequester',
              status: 'appealing',
              appealDeadline: new Date('2026-08-07T00:00:00.000Z'),
            }),
          ])
        )
        .mockReturnValueOnce(
          makeChain([
            {
              taskId: 'task-appeal',
              count: 2,
              distinctSubmitterCount: 2,
              onlySubmitter: null,
              submitters: [ADDR.toLowerCase(), '0xanother'],
            },
          ])
        )
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'task-appeal:appeal_verdict',
          intent: 'appeal_verdict',
          role: 'worker',
          priority: 'urgent',
        }),
      ]);
      expect(result.items[0]?.actions[0]).toMatchObject({
        action: 'appeal',
        eligibleAddress: ADDR,
      });
    });

    it('does not queue a recovered contest appeal for a losing submitter', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
      vi.mocked(contractGetContestAppealState).mockResolvedValueOnce({
        claimedWorker: '0x00000000000000000000000000000000000000aa',
        hasSubmission: true,
      });
      const ctx = createMockCtx(undefined, { address: ADDR.toLowerCase() });
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            makeActionQueueTask({
              id: 'task-recovered-appeal',
              requester: '0xRequester',
              status: 'appealing',
              claimedBy: null,
              appealDeadline: new Date('2026-08-07T00:00:00.000Z'),
            }),
          ])
        )
        .mockReturnValueOnce(
          makeChain([
            {
              taskId: 'task-recovered-appeal',
              count: 2,
              distinctSubmitterCount: 2,
              onlySubmitter: null,
              submitters: [ADDR.toLowerCase(), '0xanother'],
            },
          ])
        )
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result).toEqual({ items: [], total: 0, urgentTotal: 0, waiting: [] });
      expect(contractGetContestAppealState).toHaveBeenCalledOnce();
    });

    it('suppresses unsupported evaluator controls and unsafe expired refunds from totals', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
      const ctx = createMockCtx();
      ctx.db.select
        .mockReturnValueOnce(
          makeChain([
            makeActionQueueTask({
              id: 'task-evaluate',
              requester: '0xRequester',
              status: 'review',
              evaluator: ADDR,
            }),
            makeActionQueueTask({
              id: 'task-refund',
              expiryTime: new Date('2026-08-05T00:00:00.000Z'),
            }),
          ])
        )
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
      expect(result.waiting).toEqual([
        expect.objectContaining({
          id: 'task-refund:waiting_for_settlement',
          reason: 'waiting_for_settlement',
        }),
      ]);
    });

    it('returns an empty queue without aggregate queries when no role tasks exist', async () => {
      const ctx = createMockCtx();
      ctx.db.select.mockReturnValueOnce(makeChain([]));

      const result = await agentsRouter.createCaller(ctx).actionQueue({ address: ADDR });

      expect(result).toEqual({ items: [], total: 0, urgentTotal: 0, waiting: [] });
      expect(ctx.db.select).toHaveBeenCalledTimes(1);
    });
  });
});
