import { router, publicProcedure, optionalAuthProcedure } from '../trpc';
import {
  AgentStatsSchema,
  LeaderboardResponseSchema,
  LeaderboardInputSchema,
  TaskInboxInputSchema,
  TaskInboxResponseSchema,
  TaskActionQueueInputSchema,
  TaskActionQueueResponseSchema,
  type TaskResponse,
  type TaskStatusType,
  type TaskModeType,
  type TaskVisibilityType,
  type SubmissionVisibilityType,
  Secp256k1PublicKeySchema,
  normalizeAddress,
} from '@taskmarket/shared';
import { z } from 'zod';
import {
  agents,
  feedbacks,
  tasks,
  taskAwards,
  submissions,
  proposals,
  bids,
  devices,
  taskAllowedViewers,
} from '../db/schema';
import { eq, desc, sql, and, or, ilike, gte, inArray, isNull, getTableColumns } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  computeSubmissionWindowOpen,
  computeTaskPhase,
  normalizeRequesterPublicKey,
} from '../lib/task';
import { sha256Hex } from '../lib/hash';
import { lowerAddressEq } from '../lib/agents';
import { taskDiscoverable } from '../lib/task-visibility';
import { computeClockPrice } from '../lib/auction';
import {
  projectActionQueueTask,
  sortActionQueueItems,
  type ActionQueueTask,
} from '../lib/action-queue';

// Implements: ADR-0023 (inbox self-auth converged onto ctx.caller)
// inbox's `selfAuthed` check below now derives from ctx.caller (the general
// read-auth header resolved once in context.ts) instead of the bespoke,
// removed taskmarket:inbox:<address> query-param scheme (ADR-0015, superseded).
export const agentsRouter = router({
  stats: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/stats',
        tags: ['Agents'],
        summary: 'Get agent stats by address or agentId',
      },
    })
    .input(
      z.object({
        address: z.string().optional(),
        agentId: z.string().optional(),
      })
    )
    .output(AgentStatsSchema)
    .query(async ({ input, ctx }) => {
      if (!input.address && !input.agentId) {
        throw new Error('Provide address or agentId');
      }

      const agentResult = input.agentId
        ? await ctx.db.select().from(agents).where(eq(agents.agentId, input.agentId)).limit(1)
        : await ctx.db.select().from(agents).where(lowerAddressEq(input.address!)).limit(1);

      if (agentResult.length === 0) {
        const addr = input.address ?? '';
        return {
          address: addr,
          agentId: null,
          completedTasks: 0,
          ratedTasks: 0,
          totalStars: 0,
          averageRating: 0,
          totalEarnings: '0',
          skills: [],
          recentRatings: [],
        };
      }

      const agent = agentResult[0];

      const recentRatings = await ctx.db
        .select({
          taskId: feedbacks.taskId,
          rating: feedbacks.rating,
          createdAt: feedbacks.createdAt,
          taskTitle: tasks.description,
          feedbackText: feedbacks.feedbackText,
        })
        .from(feedbacks)
        .leftJoin(tasks, eq(feedbacks.taskId, tasks.id))
        .where(eq(feedbacks.workerAddress, agent.address))
        .orderBy(desc(feedbacks.createdAt))
        .limit(10);

      const averageRating = agent.ratedTasks > 0 ? agent.totalStars / agent.ratedTasks : 0;

      return {
        address: agent.address,
        agentId: agent.agentId ?? null,
        actorType: agent.registeredVia === 'web' ? ('human' as const) : ('agent' as const),
        completedTasks: agent.completedTasks,
        ratedTasks: agent.ratedTasks,
        totalStars: agent.totalStars,
        averageRating: Number(averageRating.toFixed(1)),
        credibility:
          agent.ratedTasks === 0
            ? 0
            : Math.floor((agent.ratedTasks / (agent.ratedTasks + 10)) * 1000),
        totalEarnings: agent.totalEarnings,
        skills: agent.skills ?? [],
        emailAddress: agent.emailAddress ?? null,
        recentRatings: recentRatings.map((r) => ({
          taskId: r.taskId,
          rating: r.rating,
          createdAt: r.createdAt.toISOString(),
          taskTitle: r.taskTitle?.split('\n')[0]?.slice(0, 80) ?? null,
          feedbackText: r.feedbackText,
        })),
      };
    }),

  inbox: optionalAuthProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/inbox',
        tags: ['Agents'],
        summary: 'Get tasks created and worked on by address',
      },
    })
    .input(TaskInboxInputSchema)
    .output(TaskInboxResponseSchema)
    .query(async ({ input, ctx }) => {
      const { address } = input;

      // Proof that the caller owns `address` (ADR-0016/ADR-0022): the general
      // read-auth header (X-Taskmarket-Caller-Address/-Signature), resolved
      // once per request in context.ts. When it matches the queried address,
      // the response additionally includes that address's own unlisted tasks.
      const selfAuthed = ctx.caller?.address === address.toLowerCase();

      const isWorker = or(
        sql`lower(${tasks.claimedBy}) = lower(${address})`,
        sql`exists (
          select 1 from ${taskAwards}
          where ${taskAwards.taskId} = "tasks"."id"
            and lower(${taskAwards.workerAddress}) = lower(${address})
        )`
      );

      const awardColumns = {
        awardCount: sql<number>`(
          select count(*)::int from ${taskAwards}
          where ${taskAwards.taskId} = "tasks"."id"
        )`,
        primaryAwardWorker: sql<string | null>`(
          select ${taskAwards.workerAddress} from ${taskAwards}
          where ${taskAwards.taskId} = "tasks"."id"
          order by ${taskAwards.rank} asc
          limit 1
        )`,
        primaryAwardRating: sql<number | null>`(
          select ${taskAwards.rating} from ${taskAwards}
          where ${taskAwards.taskId} = "tasks"."id"
          order by ${taskAwards.rank} asc
          limit 1
        )`,
      };

      const [requesterRows, workerRows, invitedRows] = await Promise.all([
        ctx.db
          .select({ ...getTableColumns(tasks), ...awardColumns })
          .from(tasks)
          .where(
            selfAuthed
              ? eq(tasks.requester, address)
              : and(eq(tasks.requester, address), taskDiscoverable)
          )
          .orderBy(desc(tasks.createdAt))
          .limit(50),
        ctx.db
          .select({ ...getTableColumns(tasks), ...awardColumns })
          .from(tasks)
          .where(selfAuthed ? isWorker : and(isWorker, taskDiscoverable))
          .orderBy(desc(tasks.createdAt))
          .limit(50),
        // Phase 3 (ADR-0030): the in-app invite-discovery mechanism for private tasks --
        // an address wallet-allowlisted onto a private task sees it here once it proves
        // ownership of that address, the same self-auth mechanism as the two queries
        // above. Never queried for a third party (selfAuthed === false): an unproven
        // caller asking about someone else's address has no business learning what
        // private tasks that address was invited to.
        selfAuthed
          ? ctx.db
              .select({ ...getTableColumns(tasks), ...awardColumns })
              .from(tasks)
              .innerJoin(taskAllowedViewers, eq(taskAllowedViewers.taskId, tasks.id))
              .where(
                and(
                  eq(tasks.taskVisibility, 'private'),
                  sql`lower(${taskAllowedViewers.viewerAddress}) = lower(${address})`
                )
              )
              .orderBy(desc(tasks.createdAt))
              .limit(50)
          : Promise.resolve([]),
      ]);

      // An invited wallet that has since become the assigned worker (claimedBy/awarded)
      // already shows up in workerRows -- dedupe so it isn't listed twice.
      const workerIds = new Set(workerRows.map((t) => t.id));
      const dedupedInvitedRows = invitedRows.filter((t) => !workerIds.has(t.id));

      const allRows = [...requesterRows, ...workerRows, ...dedupedInvitedRows];
      const allIds = [...new Set(allRows.map((t) => t.id))];

      const now = new Date();

      if (allIds.length === 0) {
        return { asRequester: [], asWorker: [], invitedPrivateTasks: [] };
      }

      const requesterAddresses = [...new Set(allRows.map((task) => task.requester))];
      const [submissionCounts, pitchCounts, requesterKeys] = await Promise.all([
        ctx.db
          .select({ taskId: submissions.taskId, count: sql<number>`count(*)` })
          .from(submissions)
          .where(and(inArray(submissions.taskId, allIds), isNull(submissions.rejectedAt)))
          .groupBy(submissions.taskId),
        ctx.db
          .select({ taskId: proposals.taskId, count: sql<number>`count(*)` })
          .from(proposals)
          .where(inArray(proposals.taskId, allIds))
          .groupBy(proposals.taskId),
        ctx.db
          .select({ address: agents.address, publicKey: agents.publicKey })
          .from(agents)
          .where(inArray(agents.address, requesterAddresses)),
      ]);

      const submissionCountMap = new Map(submissionCounts.map((r) => [r.taskId, Number(r.count)]));
      const pitchCountMap = new Map(pitchCounts.map((r) => [r.taskId, Number(r.count)]));
      const requesterKeyMap = new Map(requesterKeys.map((row) => [row.address, row.publicKey]));

      const mapTask = (
        task: typeof tasks.$inferSelect & {
          awardCount?: number;
          primaryAwardWorker?: string | null;
          primaryAwardRating?: number | null;
        }
      ) => {
        const sCount = submissionCountMap.get(task.id) ?? 0;
        const pCount = pitchCountMap.get(task.id) ?? 0;
        const submissionWindowOpen = computeSubmissionWindowOpen(task, now);
        const phase = computeTaskPhase(task, now);

        return {
          id: task.id,
          requester: task.requester,
          requesterPubkey: normalizeRequesterPublicKey(
            requesterKeyMap.get(task.requester),
            task.requesterPubkey
          ),
          description: task.description,
          reward: task.reward,
          escrowTxHash: task.escrowTxHash,
          createdAt: task.createdAt.toISOString(),
          expiryTime: task.expiryTime.toISOString(),
          status: task.status as TaskStatusType,
          tags: task.tags,
          primaryAward: task.primaryAwardWorker
            ? { workerAddress: task.primaryAwardWorker, rating: task.primaryAwardRating ?? null }
            : null,
          mode: task.mode as TaskModeType,
          taskVisibility: task.taskVisibility as TaskVisibilityType,
          submissionVisibility: task.submissionVisibility as SubmissionVisibilityType,
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
          submissionCount: sCount,
          awardCount: Number(task.awardCount ?? 0),
          pitchCount: pCount,
          submissionWindowOpen,
          phase,
        };
      };

      return {
        asRequester: requesterRows.map(mapTask),
        asWorker: workerRows.map(mapTask),
        invitedPrivateTasks: dedupedInvitedRows.map(mapTask),
      };
    }),

  actionQueue: optionalAuthProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/action-queue',
        tags: ['Agents'],
        summary: 'Get lifecycle actions requiring attention for an address',
      },
    })
    .input(TaskActionQueueInputSchema)
    .output(TaskActionQueueResponseSchema)
    .query(async ({ input, ctx }) => {
      const { address } = input;
      const normalizedAddress = address.toLowerCase();
      const selfAuthed = ctx.caller?.address.toLowerCase() === normalizedAddress;
      const roleMembership = or(
        sql`lower(${tasks.requester}) = lower(${address})`,
        sql`lower(${tasks.claimedBy}) = lower(${address})`,
        sql`lower(${tasks.evaluator}) = lower(${address})`,
        sql`lower(${tasks.disputeResolver}) = lower(${address})`,
        sql`exists (
          select 1 from ${taskAwards}
          where ${taskAwards.taskId} = "tasks"."id"
            and lower(${taskAwards.workerAddress}) = lower(${address})
        )`,
        sql`exists (
          select 1 from ${submissions}
          where ${submissions.taskId} = "tasks"."id"
            and lower(${submissions.workerAddress}) = lower(${address})
            and (${submissions.rejectedAt} is null or "tasks"."status" = 'appealing')
        )`
      )!;

      const candidateRows = await ctx.db
        .select({ ...getTableColumns(tasks) })
        .from(tasks)
        .where(selfAuthed ? roleMembership : and(roleMembership, taskDiscoverable))
        .orderBy(desc(tasks.createdAt));

      if (candidateRows.length === 0) {
        return { items: [], total: 0, urgentTotal: 0, waiting: [] };
      }

      const taskIds = candidateRows.map((task) => task.id);
      const [submissionRows, pitchRows, bidRows, awardRows] = await Promise.all([
        ctx.db
          .select({
            taskId: submissions.taskId,
            count: sql<number>`count(*) filter (where ${submissions.rejectedAt} is null)::int`,
            distinctSubmitterCount: sql<number>`count(distinct lower(${submissions.workerAddress})) filter (where ${submissions.rejectedAt} is null)::int`,
            onlySubmitter: sql<string | null>`case
              when count(distinct lower(${submissions.workerAddress})) filter (where ${submissions.rejectedAt} is null) = 1
                then min(${submissions.workerAddress}) filter (where ${submissions.rejectedAt} is null)
              else null
            end`,
            submitters: sql<
              string[]
            >`coalesce(array_agg(distinct lower(${submissions.workerAddress})) filter (where ${submissions.rejectedAt} is null), '{}')`,
            allSubmitters: sql<string[]>`array_agg(distinct lower(${submissions.workerAddress}))`,
          })
          .from(submissions)
          .where(inArray(submissions.taskId, taskIds))
          .groupBy(submissions.taskId),
        ctx.db
          .select({ taskId: proposals.taskId, count: sql<number>`count(*)::int` })
          .from(proposals)
          .where(inArray(proposals.taskId, taskIds))
          .groupBy(proposals.taskId),
        ctx.db
          .select({
            taskId: bids.taskId,
            count: sql<number>`count(*)::int`,
            lowestPrice: sql<string | null>`min(${bids.price})::text`,
          })
          .from(bids)
          .where(inArray(bids.taskId, taskIds))
          .groupBy(bids.taskId),
        ctx.db
          .select({
            taskId: taskAwards.taskId,
            workerAddress: taskAwards.workerAddress,
            rank: taskAwards.rank,
            rating: taskAwards.rating,
          })
          .from(taskAwards)
          .where(inArray(taskAwards.taskId, taskIds)),
      ]);

      const submissionsByTask = new Map(submissionRows.map((row) => [row.taskId, row]));
      const pitchesByTask = new Map(pitchRows.map((row) => [row.taskId, Number(row.count)]));
      const bidsByTask = new Map(bidRows.map((row) => [row.taskId, row]));
      const awardsByTask = new Map<
        string,
        Array<{ workerAddress: string; rank: number; rating: number | null }>
      >();
      for (const award of awardRows) {
        const awards = awardsByTask.get(award.taskId) ?? [];
        awards.push(award);
        awardsByTask.set(award.taskId, awards);
      }

      const now = new Date();
      const queueTasks: ActionQueueTask[] = candidateRows.map((task) => {
        const submission = submissionsByTask.get(task.id);
        const taskBids = bidsByTask.get(task.id);
        const taskAwardsForTask = awardsByTask.get(task.id) ?? [];
        const submissionCount = Number(submission?.count ?? 0);
        const pitchCount = pitchesByTask.get(task.id) ?? 0;
        const bidCount = Number(taskBids?.count ?? 0);
        const currentClockPrice =
          task.auctionType === 'dutch' || task.auctionType === 'reverse_dutch'
            ? computeClockPrice(task, now)
            : null;
        const primaryAward = [...taskAwardsForTask].sort(
          (left, right) => left.rank - right.rank
        )[0];
        const responseTask: TaskResponse = {
          id: task.id,
          requester: task.requester,
          requesterPubkey: normalizeRequesterPublicKey(undefined, task.requesterPubkey),
          description: task.description,
          reward: task.reward,
          escrowTxHash: task.escrowTxHash,
          createdAt: task.createdAt.toISOString(),
          expiryTime: task.expiryTime.toISOString(),
          status: task.status as TaskStatusType,
          tags: task.tags,
          primaryAward: primaryAward
            ? { workerAddress: primaryAward.workerAddress, rating: primaryAward.rating }
            : null,
          mode: task.mode as TaskModeType,
          taskVisibility: task.taskVisibility as TaskVisibilityType,
          submissionVisibility: task.submissionVisibility as SubmissionVisibilityType,
          hasAccessPassword: task.privateAccessPasswordHash != null,
          stakeRequired: task.stakeRequired === 1,
          stakeBps: task.stakeBps,
          pitchDeadline: task.pitchDeadline?.toISOString() ?? null,
          bidDeadline: task.bidDeadline?.toISOString() ?? null,
          maxPrice: task.maxPrice ?? null,
          metricDescription: task.metricDescription,
          metricTarget: task.metricTarget,
          claimedBy: task.claimedBy,
          claimedAt: task.claimedAt?.toISOString() ?? null,
          platformFeeBps: task.platformFeeBps,
          submissionCount,
          awardCount: taskAwardsForTask.length,
          pitchCount,
          auctionType: task.auctionType as TaskResponse['auctionType'],
          auctionStartPrice: task.auctionStartPrice ?? null,
          auctionFloorPrice: task.auctionFloorPrice ?? null,
          currentAuctionPrice: currentClockPrice?.toString() ?? null,
          auctionBidCount: bidCount,
          currentLowestBid: taskBids?.lowestPrice ?? null,
          evaluator: task.evaluator ?? null,
          evaluatorStake: task.evaluatorStake ?? null,
          evaluatorFeeBps: task.evaluatorFeeBps ?? null,
          evaluationWindow: task.evaluationWindow ?? null,
          appealWindow: task.appealWindow ?? null,
          disputeResolver: task.disputeResolver ?? null,
          appealDeadline: task.appealDeadline?.toISOString() ?? null,
          evaluatorDeadline: task.evaluatorDeadline?.toISOString() ?? null,
          verdictType: task.verdictType as TaskResponse['verdictType'],
          verdictScore: task.verdictScore ?? null,
          verdictConfidence: task.verdictConfidence ?? null,
          verdictEvidenceHash: task.verdictEvidenceHash ?? null,
          selfAward: task.selfAward,
          taskDropId: task.taskDropId ?? null,
          hookContract: task.hookContract ?? null,
          submissionWindowOpen: computeSubmissionWindowOpen(task, now),
          phase: computeTaskPhase(task, now),
        };

        return {
          task: responseTask,
          submitterAddresses: submission?.submitters ?? [],
          pendingActionTask: {
            id: task.id,
            requester: task.requester,
            status: task.status,
            mode: task.mode,
            pitchCount,
            bidCount,
            submissionCount,
            expiryTime: task.expiryTime,
            pitchDeadline: task.pitchDeadline,
            bidDeadline: task.bidDeadline,
            claimedBy: task.claimedBy,
            auctionType: task.auctionType,
            currentClockPrice,
            currentLowestBid: taskBids?.lowestPrice ?? null,
            latestSubmissionWorker:
              Number(submission?.distinctSubmitterCount ?? 0) === 1
                ? (submission?.onlySubmitter ?? null)
                : null,
            appealEligibleWorker: (submission?.allSubmitters ?? []).some(
              (submitter) => submitter.toLowerCase() === address.toLowerCase()
            )
              ? address
              : null,
            evaluator: task.evaluator,
            disputeResolver: task.disputeResolver,
            evaluatorDeadline: task.evaluatorDeadline,
            appealDeadline: task.appealDeadline,
            awardWorkers: taskAwardsForTask.map((award) => ({
              workerAddress: award.workerAddress,
              rating: award.rating,
            })),
          },
        };
      });

      const projections = queueTasks.map((task) => projectActionQueueTask(task, address, now));
      const items = sortActionQueueItems(projections.flatMap((projection) => projection.items));
      const waiting = projections.flatMap((projection) => projection.waiting);

      return {
        items,
        total: items.length,
        urgentTotal: items.filter((item) => item.priority === 'urgent').length,
        waiting,
      };
    }),

  count: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/count',
        tags: ['Agents'],
        summary: 'Get total number of registered agents',
      },
    })
    .input(z.object({}))
    .output(z.object({ count: z.number(), totalEarnings: z.string() }))
    .query(async ({ ctx }) => {
      const result = await ctx.db
        .select({
          count: sql<number>`count(*)::int`,
          totalEarnings: sql<string>`coalesce(sum(${agents.totalEarnings}::numeric), 0)::text`,
        })
        .from(agents);
      return {
        count: result[0]?.count ?? 0,
        totalEarnings: result[0]?.totalEarnings ?? '0',
      };
    }),

  leaderboard: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/leaderboard',
        tags: ['Agents'],
        summary:
          'List agents sorted by reputation or task count, with optional skill/search filter',
      },
    })
    .input(LeaderboardInputSchema)
    .output(LeaderboardResponseSchema)
    .query(async ({ input, ctx }) => {
      const avgRatingExpr = sql<number>`(${agents.totalStars} + 500)::float / (${agents.ratedTasks} + 10)`;

      const filters: SQL[] = [];

      if (input.skill) {
        // Safe parameterized: value passed as bind parameter, not raw SQL
        filters.push(sql`${input.skill} = ANY(${agents.skills})`);
      }

      if (input.search) {
        filters.push(
          or(ilike(agents.agentId, `%${input.search}%`), ilike(agents.address, `${input.search}%`))!
        );
      }

      if (input.minRating) {
        filters.push(sql`${avgRatingExpr} >= ${input.minRating}`);
      }

      if (input.minTasks) {
        filters.push(gte(agents.completedTasks, input.minTasks));
      }

      if (input.actorType) {
        const channel = input.actorType === 'human' ? 'web' : 'cli';
        filters.push(eq(agents.registeredVia, channel));
      }

      const whereClause =
        filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)!;

      const orderBy =
        input.sort === 'tasks'
          ? [desc(agents.completedTasks), desc(avgRatingExpr)]
          : [desc(avgRatingExpr), desc(agents.completedTasks)];

      const results = await ctx.db
        .select({
          address: agents.address,
          agentId: agents.agentId,
          completedTasks: agents.completedTasks,
          ratedTasks: agents.ratedTasks,
          totalStars: agents.totalStars,
          totalEarnings: agents.totalEarnings,
          skills: agents.skills,
          emailAddress: agents.emailAddress,
          registeredVia: agents.registeredVia,
        })
        .from(agents)
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(input.limit)
        .offset(input.offset);

      return results.map((row, index) => ({
        rank: input.offset + index + 1,
        address: row.address,
        agentId: row.agentId ?? null,
        actorType: row.registeredVia === 'web' ? ('human' as const) : ('agent' as const),
        completedTasks: row.completedTasks,
        averageRating: Number(((row.totalStars + 500) / (row.ratedTasks + 10)).toFixed(1)),
        credibility:
          row.ratedTasks === 0 ? 0 : Math.floor((row.ratedTasks / (row.ratedTasks + 10)) * 1000),
        totalEarnings: row.totalEarnings ?? '0',
        skills: row.skills ?? [],
        emailAddress: row.emailAddress ?? null,
      }));
    }),

  publicKey: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/agents/public-key',
        tags: ['Agents'],
        summary: 'Get published public key for an agent address (for ECIES encryption)',
      },
    })
    .input(z.object({ address: z.string() }))
    .output(z.object({ publicKey: z.string() }))
    .query(async ({ input, ctx }) => {
      const result = await ctx.db
        .select({ publicKey: agents.publicKey })
        .from(agents)
        .where(lowerAddressEq(input.address))
        .limit(1);

      const publicKey = normalizeRequesterPublicKey(result[0]?.publicKey, null);
      if (!publicKey) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message:
            'Recipient has not published their public key. Ask them to run: taskmarket wallet publish-key',
        });
      }

      return { publicKey };
    }),

  setPublicKey: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/agents/public-key',
        tags: ['Agents'],
        summary: 'Store agent public key (device apiToken auth)',
      },
    })
    .input(
      z.object({
        deviceId: z.string(),
        apiToken: z.string(),
        publicKey: Secp256k1PublicKeySchema,
      })
    )
    .output(z.object({ publicKey: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const deviceResult = await ctx.db
        .select()
        .from(devices)
        .where(eq(devices.id, input.deviceId))
        .limit(1);

      if (!deviceResult.length) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Device not found' });
      }

      const device = deviceResult[0];

      if (device.apiTokenHash !== sha256Hex(input.apiToken)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid token' });
      }

      if (device.revokedAt !== null) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Device has been revoked' });
      }

      await ctx.db
        .insert(agents)
        .values({ address: normalizeAddress(device.walletAddress), publicKey: input.publicKey })
        .onConflictDoUpdate({
          target: agents.address,
          set: { publicKey: input.publicKey, updatedAt: new Date() },
        });

      return { publicKey: input.publicKey };
    }),
});
