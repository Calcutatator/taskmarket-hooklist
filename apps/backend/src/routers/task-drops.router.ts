import { randomUUID } from 'crypto';
import {
  TaskDropAnnouncementInputSchema,
  TaskDropAnnouncementResponseSchema,
  TaskDropDirectoryInputSchema,
  TaskDropDirectoryResponseSchema,
  TaskDropGetInputSchema,
  TaskDropListByOwnerInputSchema,
  TaskDropOfficialStatusInputSchema,
  TaskDropOfficialStatusResponseSchema,
  TaskDropOfficialSubscribeInputSchema,
  TaskDropOfficialSubscribeResponseSchema,
  TaskDropPageDataSchema,
  TaskDropStatusInputSchema,
  TaskDropStatusResponseSchema,
  TaskDropSummarySchema,
  TaskDropSubscribeInputSchema,
  TaskDropSubscribeResponseSchema,
} from '@taskmarket/shared';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';

import { getServerConfig } from '../config/env';
import { taskDrops, taskDropSubscriptions, tasks } from '../db/schema';
import { logger } from '../lib/logger';
import { isOfficialTaskDropOwner } from '../lib/task-drops';
import { secureCompare } from '../lib/secure-compare';
import { taskDiscoverable } from '../lib/task-visibility';
import { announceOfficialTaskDrop } from '../services/task-drop-announcements';
import { enforceTaskDropSubscribeRateLimit } from '../services/task-drop-subscribe-rate-limit';
import { sendOfficialTaskDropsWelcome, sendTaskDropsWelcome } from '../services/task-drops-email';
import { publicProcedure, router } from '../trpc';

function serializeDrop(row: typeof taskDrops.$inferSelect) {
  const officialWalletAddress = row.ownerAddress.toLowerCase();

  return {
    id: row.id,
    ownerAddress: officialWalletAddress,
    officialWalletAddress,
    isOfficial: isOfficialTaskDropOwner(officialWalletAddress),
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    announcedAt: row.announcedAt?.toISOString() ?? null,
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isUniqueViolation(error.cause);
}

type DirectoryCursor = {
  acceptsWorkRank: 0 | 1;
  officialRank: 0 | 1;
  latestTaskAtRank: string;
  id: string;
};

function encodeDirectoryCursor(cursor: DirectoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeDirectoryCursor(cursor: string | undefined): DirectoryCursor | null {
  if (!cursor) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      !('acceptsWorkRank' in decoded) ||
      (decoded.acceptsWorkRank !== 0 && decoded.acceptsWorkRank !== 1) ||
      !('officialRank' in decoded) ||
      (decoded.officialRank !== 0 && decoded.officialRank !== 1) ||
      !('latestTaskAtRank' in decoded) ||
      typeof decoded.latestTaskAtRank !== 'string' ||
      !/^\d+$/.test(decoded.latestTaskAtRank) ||
      !('id' in decoded) ||
      typeof decoded.id !== 'string' ||
      decoded.id.length === 0
    ) {
      throw new Error('Invalid cursor');
    }
    return {
      acceptsWorkRank: decoded.acceptsWorkRank,
      officialRank: decoded.officialRank,
      latestTaskAtRank: decoded.latestTaskAtRank,
      id: decoded.id,
    };
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Task Drop directory cursor' });
  }
}

function aggregateDateToISOString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export const taskDropsRouter = router({
  listByOwner: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/task-drops',
        tags: ['Task Drops'],
        summary: 'List Task Drops owned by a wallet',
      },
    })
    .input(TaskDropListByOwnerInputSchema)
    .output(TaskDropSummarySchema.array())
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select()
        .from(taskDrops)
        .where(sql`lower(${taskDrops.ownerAddress}) = ${input.ownerAddress.toLowerCase()}`)
        .orderBy(desc(taskDrops.createdAt));

      return rows.map(serializeDrop);
    }),

  listPublic: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/task-drops/directory',
        tags: ['Task Drops'],
        summary: 'List public Task Drops',
      },
    })
    .input(TaskDropDirectoryInputSchema)
    .output(TaskDropDirectoryResponseSchema)
    .query(async ({ input, ctx }) => {
      const now = new Date();
      const cursor = decodeDirectoryCursor(input.cursor);
      const officialOwners = getServerConfig().OFFICIAL_TASK_DROP_OWNER_ADDRESSES ?? [];

      // A Task Drop advertises work only while its delivery window is open.
      // pending_approval remains an active lifecycle phase, but delivery is complete.
      const availableTaskCondition = and(
        inArray(tasks.status, ['open', 'claimed', 'worker_selected']),
        gt(tasks.expiryTime, now)
      );
      const availableTaskCount = sql<number>`count(*) filter (where ${availableTaskCondition})`.as(
        'available_task_count'
      );
      const taskCount = sql<number>`count(*)`.as('task_count');
      const resolvedTaskCount = sql<number>`count(*) filter (where ${inArray(tasks.status, [
        'completed',
        'cancelled',
        'expired',
      ])})`.as('resolved_task_count');
      const totalReward = sql<string>`coalesce(sum(${tasks.reward}), 0)::text`.as('total_reward');
      const nextExpiryTime = sql<
        Date | string | null
      >`min(${tasks.expiryTime}) filter (where ${availableTaskCondition})`.as('next_expiry_time');
      const latestTaskAtExpression = sql<
        Date | string
      >`date_trunc('milliseconds', max(${tasks.createdAt}))`;
      const latestTaskAt = latestTaskAtExpression.as('latest_task_at');
      const latestTaskAtRankExpression = sql<string>`floor(extract(epoch from max(${tasks.createdAt})) * 1000)::bigint`;
      const latestTaskAtRank = latestTaskAtRankExpression.as('latest_task_at_rank');
      const acceptsWorkRankExpression = sql<number>`case when count(*) filter (where ${availableTaskCondition}) > 0 then 1 else 0 end`;
      const acceptsWorkRank = acceptsWorkRankExpression.as('accepts_work_rank');
      const officialDropCondition =
        officialOwners.length > 0
          ? inArray(sql<string>`lower(${taskDrops.ownerAddress})`, officialOwners)
          : sql<boolean>`false`;
      const officialRankExpression = sql<number>`case when ${officialDropCondition} then 1 else 0 end`;
      const officialRank = officialRankExpression.as('official_rank');
      const cursorCondition = cursor
        ? or(
            sql`${acceptsWorkRankExpression} < ${cursor.acceptsWorkRank}`,
            and(
              sql`${acceptsWorkRankExpression} = ${cursor.acceptsWorkRank}`,
              sql`${officialRankExpression} < ${cursor.officialRank}`
            ),
            and(
              sql`${acceptsWorkRankExpression} = ${cursor.acceptsWorkRank}`,
              sql`${officialRankExpression} = ${cursor.officialRank}`,
              sql`${latestTaskAtRankExpression} < ${cursor.latestTaskAtRank}`
            ),
            and(
              sql`${acceptsWorkRankExpression} = ${cursor.acceptsWorkRank}`,
              sql`${officialRankExpression} = ${cursor.officialRank}`,
              sql`${latestTaskAtRankExpression} = ${cursor.latestTaskAtRank}`,
              gt(taskDrops.id, cursor.id)
            )
          )
        : undefined;

      const groupedQuery = ctx.db
        .select({
          id: taskDrops.id,
          ownerAddress: taskDrops.ownerAddress,
          name: taskDrops.name,
          description: taskDrops.description,
          createdAt: taskDrops.createdAt,
          announcedAt: taskDrops.announcedAt,
          availableTaskCount,
          taskCount,
          resolvedTaskCount,
          totalReward,
          nextExpiryTime,
          latestTaskAt,
          latestTaskAtRank,
          acceptsWorkRank,
          officialRank,
        })
        .from(taskDrops)
        .innerJoin(tasks, eq(tasks.taskDropId, taskDrops.id))
        .where(taskDiscoverable)
        .groupBy(taskDrops.id);
      const pagedQuery = cursorCondition ? groupedQuery.having(cursorCondition) : groupedQuery;
      const rows = await pagedQuery
        .orderBy(
          desc(acceptsWorkRank),
          desc(officialRank),
          desc(latestTaskAtRank),
          asc(taskDrops.id)
        )
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;

      return {
        items: page.map((row) => ({
          drop: serializeDrop(row),
          availableTaskCount: Number(row.availableTaskCount),
          taskCount: Number(row.taskCount),
          resolvedTaskCount: Number(row.resolvedTaskCount),
          totalReward: row.totalReward.toString(),
          nextExpiryTime: row.nextExpiryTime ? aggregateDateToISOString(row.nextExpiryTime) : null,
          latestTaskAt: aggregateDateToISOString(row.latestTaskAt),
        })),
        nextCursor:
          hasMore && page.at(-1)
            ? encodeDirectoryCursor({
                acceptsWorkRank: Number(page.at(-1)!.acceptsWorkRank) === 1 ? 1 : 0,
                officialRank: Number(page.at(-1)!.officialRank) === 1 ? 1 : 0,
                latestTaskAtRank: page.at(-1)!.latestTaskAtRank.toString(),
                id: page.at(-1)!.id,
              })
            : null,
      };
    }),

  get: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/task-drops/{taskDropId}',
        tags: ['Task Drops'],
        summary: 'Get a Task Drop and its tasks',
      },
    })
    .input(TaskDropGetInputSchema)
    .output(TaskDropPageDataSchema.nullable())
    .query(async ({ input, ctx }) => {
      const dropRows = await ctx.db
        .select()
        .from(taskDrops)
        .where(eq(taskDrops.id, input.taskDropId))
        .limit(1);
      const drop = dropRows[0];

      if (!drop) {
        return null;
      }

      const taskRows = await ctx.db
        .select({
          id: tasks.id,
          description: tasks.description,
          reward: tasks.reward,
          status: tasks.status,
          mode: tasks.mode,
          tags: tasks.tags,
          createdAt: tasks.createdAt,
          expiryTime: tasks.expiryTime,
        })
        .from(tasks)
        .where(and(eq(tasks.taskDropId, input.taskDropId), taskDiscoverable))
        .orderBy(desc(tasks.createdAt));

      return {
        drop: serializeDrop(drop),
        tasks: taskRows.map((task) => ({
          ...task,
          reward: task.reward.toString(),
          createdAt: task.createdAt.toISOString(),
          expiryTime: task.expiryTime.toISOString(),
        })),
      };
    }),

  subscribe: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/task-drops/subscribe',
        tags: ['Task Drops'],
        summary: 'Subscribe to Task Drops',
      },
    })
    .input(TaskDropSubscribeInputSchema)
    .output(TaskDropSubscribeResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const now = new Date();
      const dropRows = await ctx.db
        .select({ id: taskDrops.id, ownerAddress: taskDrops.ownerAddress })
        .from(taskDrops)
        .where(eq(taskDrops.id, input.taskDropId))
        .limit(1);

      if (!dropRows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task drop not found' });
      }

      if (isOfficialTaskDropOwner(dropRows[0].ownerAddress)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Subscribe to all official Task Drops instead',
        });
      }

      const existing = await ctx.db
        .select()
        .from(taskDropSubscriptions)
        .where(
          and(
            eq(taskDropSubscriptions.taskDropId, input.taskDropId),
            eq(taskDropSubscriptions.scope, 'drop'),
            sql`lower(${taskDropSubscriptions.email}) = ${input.email}`
          )
        )
        .limit(1);

      const existingRow = existing[0];
      if (existingRow?.status === 'active') {
        return {
          alreadySubscribed: true,
          email: existingRow.email,
          subscribed: true,
          scope: 'drop' as const,
          taskDropId: input.taskDropId,
        };
      }

      const clientAddress = ctx.req.ip || ctx.req.socket?.remoteAddress || 'unknown';
      await enforceTaskDropSubscribeRateLimit({ db: ctx.db, email: input.email, clientAddress });

      if (existingRow) {
        await ctx.db
          .update(taskDropSubscriptions)
          .set({
            agentAddress: input.source === 'agent_setup' ? (input.walletAddress ?? null) : null,
            consentedAt: now,
            source: input.source,
            status: 'active',
            unsubscribedAt: null,
            updatedAt: now,
            walletAddress: input.walletAddress ?? existingRow.walletAddress,
          })
          .where(eq(taskDropSubscriptions.id, existingRow.id));

        void sendTaskDropsWelcome({
          db: ctx.db,
          subscription: { ...existingRow, status: 'active' },
          taskDropId: input.taskDropId,
        }).catch((error: unknown) => {
          logger.warn(
            `sendTaskDropsWelcome failed for ${existingRow.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });

        return {
          alreadySubscribed: false,
          email: existingRow.email,
          subscribed: true,
          scope: 'drop' as const,
          taskDropId: input.taskDropId,
        };
      }

      const id = randomUUID();
      try {
        await ctx.db.insert(taskDropSubscriptions).values({
          id,
          agentAddress: input.source === 'agent_setup' ? (input.walletAddress ?? null) : null,
          consentedAt: now,
          email: input.email,
          source: input.source,
          scope: 'drop',
          status: 'active',
          taskDropId: input.taskDropId,
          walletAddress: input.walletAddress ?? null,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;

        const concurrentRows = await ctx.db
          .select()
          .from(taskDropSubscriptions)
          .where(
            and(
              eq(taskDropSubscriptions.taskDropId, input.taskDropId),
              eq(taskDropSubscriptions.scope, 'drop'),
              sql`lower(${taskDropSubscriptions.email}) = ${input.email}`
            )
          )
          .limit(1);
        const concurrentSubscription = concurrentRows[0];

        if (!concurrentSubscription || concurrentSubscription.status !== 'active') throw error;

        return {
          alreadySubscribed: true,
          email: concurrentSubscription.email,
          subscribed: true,
          scope: 'drop' as const,
          taskDropId: input.taskDropId,
        };
      }

      void sendTaskDropsWelcome({
        db: ctx.db,
        subscription: {
          email: input.email,
          id,
          scope: 'drop',
          status: 'active',
          taskDropId: input.taskDropId,
        },
        taskDropId: input.taskDropId,
      }).catch((error: unknown) => {
        logger.warn(
          `sendTaskDropsWelcome failed for ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });

      return {
        alreadySubscribed: false,
        email: input.email,
        subscribed: true,
        scope: 'drop' as const,
        taskDropId: input.taskDropId,
      };
    }),

  subscribeOfficial: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/task-drops/official/subscribe',
        tags: ['Task Drops'],
        summary: 'Subscribe to all official Task Drops',
      },
    })
    .input(TaskDropOfficialSubscribeInputSchema)
    .output(TaskDropOfficialSubscribeResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const existingRows = await ctx.db
        .select()
        .from(taskDropSubscriptions)
        .where(
          and(
            eq(taskDropSubscriptions.scope, 'official'),
            sql`lower(${taskDropSubscriptions.email}) = ${input.email}`
          )
        )
        .limit(1);
      const existing = existingRows[0];

      if (existing?.status === 'active') {
        return {
          alreadySubscribed: true,
          email: existing.email,
          scope: 'official' as const,
          subscribed: true,
        };
      }

      const clientAddress = ctx.req.ip || ctx.req.socket?.remoteAddress || 'unknown';
      await enforceTaskDropSubscribeRateLimit({ db: ctx.db, email: input.email, clientAddress });

      const now = new Date();
      const id = existing?.id ?? randomUUID();
      let activated = true;
      try {
        activated = await ctx.db.transaction(async (tx) => {
          if (existing) {
            const lockedRows = await tx
              .select()
              .from(taskDropSubscriptions)
              .where(eq(taskDropSubscriptions.id, existing.id))
              .limit(1)
              .for('update');
            const locked = lockedRows[0];
            if (!locked) throw new Error('Official Task Drops subscription disappeared');
            if (locked.status === 'active') return false;

            await tx
              .update(taskDropSubscriptions)
              .set({
                consentedAt: now,
                source: input.source,
                status: 'active',
                unsubscribedAt: null,
                updatedAt: now,
                walletAddress: input.walletAddress ?? existing.walletAddress,
              })
              .where(eq(taskDropSubscriptions.id, existing.id));
          } else {
            await tx.insert(taskDropSubscriptions).values({
              id,
              consentedAt: now,
              email: input.email,
              scope: 'official',
              source: input.source,
              status: 'active',
              taskDropId: null,
              walletAddress: input.walletAddress ?? null,
            });
          }

          const officialOwners = getServerConfig().OFFICIAL_TASK_DROP_OWNER_ADDRESSES;
          if (officialOwners.length > 0) {
            await tx
              .update(taskDropSubscriptions)
              .set({ status: 'superseded', updatedAt: now })
              .where(
                and(
                  eq(taskDropSubscriptions.scope, 'drop'),
                  eq(taskDropSubscriptions.status, 'active'),
                  sql`lower(${taskDropSubscriptions.email}) = ${input.email}`,
                  sql`${taskDropSubscriptions.taskDropId} IN (
                    SELECT ${taskDrops.id}
                    FROM ${taskDrops}
                    WHERE lower(${taskDrops.ownerAddress}) IN (${sql.join(
                      officialOwners.map((owner) => sql`${owner}`),
                      sql`, `
                    )})
                  )`
                )
              );
          }

          return true;
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const concurrentRows = await ctx.db
          .select()
          .from(taskDropSubscriptions)
          .where(
            and(
              eq(taskDropSubscriptions.scope, 'official'),
              eq(taskDropSubscriptions.status, 'active'),
              sql`lower(${taskDropSubscriptions.email}) = ${input.email}`
            )
          )
          .limit(1);
        if (!concurrentRows[0]) throw error;
        return {
          alreadySubscribed: true,
          email: concurrentRows[0].email,
          scope: 'official' as const,
          subscribed: true,
        };
      }

      if (!activated) {
        return {
          alreadySubscribed: true,
          email: input.email,
          scope: 'official' as const,
          subscribed: true,
        };
      }

      void sendOfficialTaskDropsWelcome({
        consentAt: now,
        db: ctx.db,
        subscription: {
          email: input.email,
          id,
          scope: 'official',
          status: 'active',
          taskDropId: null,
        },
      }).catch((error: unknown) => {
        logger.warn(
          `sendOfficialTaskDropsWelcome failed for ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });

      return {
        alreadySubscribed: false,
        email: input.email,
        scope: 'official' as const,
        subscribed: true,
      };
    }),

  officialStatus: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/task-drops/official/status',
        tags: ['Task Drops'],
        summary: 'Get official Task Drops subscription status',
      },
    })
    .input(TaskDropOfficialStatusInputSchema)
    .output(TaskDropOfficialStatusResponseSchema)
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select({ id: taskDropSubscriptions.id })
        .from(taskDropSubscriptions)
        .where(
          and(
            eq(taskDropSubscriptions.scope, 'official'),
            eq(taskDropSubscriptions.status, 'active'),
            sql`lower(${taskDropSubscriptions.email}) = ${input.email}`
          )
        )
        .limit(1);

      return { scope: rows[0] ? ('official' as const) : null, subscribed: Boolean(rows[0]) };
    }),

  announceOfficial: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/task-drops/{taskDropId}/announce',
        tags: ['Task Drops'],
        summary: 'Announce an official Task Drop (admin only)',
      },
    })
    .input(TaskDropAnnouncementInputSchema)
    .output(TaskDropAnnouncementResponseSchema)
    .mutation(async ({ input, ctx }) => {
      const config = getServerConfig();
      const adminSecret = headerValue(ctx.req.headers?.['x-admin-secret']);
      if (!config.ADMIN_SECRET || !secureCompare(adminSecret, config.ADMIN_SECRET)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid admin secret' });
      }

      const dropRows = await ctx.db
        .select({
          announcedAt: taskDrops.announcedAt,
          id: taskDrops.id,
          ownerAddress: taskDrops.ownerAddress,
        })
        .from(taskDrops)
        .where(eq(taskDrops.id, input.taskDropId))
        .limit(1);
      const drop = dropRows[0];
      if (!drop) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task drop not found' });
      if (!isOfficialTaskDropOwner(drop.ownerAddress)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task drop is not official' });
      }

      const result = await announceOfficialTaskDrop({ db: ctx.db, taskDropId: input.taskDropId });
      return {
        ...result,
        announcedAt: result.announcedAt.toISOString(),
        taskDropId: input.taskDropId,
      };
    }),

  status: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/task-drops/status',
        tags: ['Task Drops'],
        summary: 'Get Task Drops subscription status',
      },
    })
    .input(TaskDropStatusInputSchema)
    .output(TaskDropStatusResponseSchema)
    .query(async ({ input, ctx }) => {
      const rows = await ctx.db
        .select()
        .from(taskDropSubscriptions)
        .where(
          and(
            eq(taskDropSubscriptions.taskDropId, input.taskDropId),
            eq(taskDropSubscriptions.scope, 'drop'),
            sql`lower(${taskDropSubscriptions.email}) = ${input.email}`,
            eq(taskDropSubscriptions.status, 'active')
          )
        )
        .limit(1);

      const row = rows[0];
      return {
        scope: row ? ('drop' as const) : null,
        subscribed: Boolean(row),
        taskDropId: input.taskDropId,
      };
    }),
});
