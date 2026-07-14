import { randomUUID } from 'crypto';
import {
  TaskDropGetInputSchema,
  TaskDropListByOwnerInputSchema,
  TaskDropPageDataSchema,
  TaskDropStatusInputSchema,
  TaskDropStatusResponseSchema,
  TaskDropSummarySchema,
  TaskDropSubscribeInputSchema,
  TaskDropSubscribeResponseSchema,
} from '@taskmarket/shared';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, sql } from 'drizzle-orm';

import { taskDrops, taskDropSubscriptions, tasks } from '../db/schema';
import { logger } from '../lib/logger';
import { sendTaskDropsWelcome } from '../services/task-drops-email';
import { publicProcedure, router } from '../trpc';

const SUBSCRIBE_RATE_WINDOW_MS = 60 * 60 * 1000;
const SUBSCRIBE_LIMIT_PER_EMAIL = 3;
const SUBSCRIBE_LIMIT_PER_CLIENT = 10;
const subscribeTimestampsByEmail = new Map<string, number[]>();
const subscribeTimestampsByClient = new Map<string, number[]>();

export function _clearTaskDropSubscribeRateLimitForTests(): void {
  subscribeTimestampsByEmail.clear();
  subscribeTimestampsByClient.clear();
}

function recentTimestamps(timestamps: number[] | undefined, cutoff: number): number[] {
  return (timestamps ?? []).filter((timestamp) => timestamp > cutoff);
}

function checkTaskDropSubscribeRateLimit(email: string, clientAddress: string): void {
  const now = Date.now();
  const cutoff = now - SUBSCRIBE_RATE_WINDOW_MS;
  const emailTimestamps = recentTimestamps(subscribeTimestampsByEmail.get(email), cutoff);
  const clientTimestamps = recentTimestamps(subscribeTimestampsByClient.get(clientAddress), cutoff);

  if (
    emailTimestamps.length >= SUBSCRIBE_LIMIT_PER_EMAIL ||
    clientTimestamps.length >= SUBSCRIBE_LIMIT_PER_CLIENT
  ) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many subscription attempts. Try again later.',
    });
  }

  emailTimestamps.push(now);
  clientTimestamps.push(now);
  subscribeTimestampsByEmail.set(email, emailTimestamps);
  subscribeTimestampsByClient.set(clientAddress, clientTimestamps);
}

function serializeDrop(row: typeof taskDrops.$inferSelect) {
  const officialWalletAddress = row.ownerAddress.toLowerCase();

  return {
    id: row.id,
    ownerAddress: officialWalletAddress,
    officialWalletAddress,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error && isUniqueViolation(error.cause);
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
        .where(eq(tasks.taskDropId, input.taskDropId))
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
        .select({ id: taskDrops.id })
        .from(taskDrops)
        .where(eq(taskDrops.id, input.taskDropId))
        .limit(1);

      if (!dropRows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Task drop not found' });
      }

      const existing = await ctx.db
        .select()
        .from(taskDropSubscriptions)
        .where(
          and(
            eq(taskDropSubscriptions.taskDropId, input.taskDropId),
            eq(taskDropSubscriptions.email, input.email)
          )
        )
        .limit(1);

      const existingRow = existing[0];
      if (existingRow?.status === 'active') {
        return {
          alreadySubscribed: true,
          email: existingRow.email,
          subscribed: true,
          taskDropId: input.taskDropId,
        };
      }

      const clientAddress = ctx.req.ip || ctx.req.socket?.remoteAddress || 'unknown';
      checkTaskDropSubscribeRateLimit(input.email, clientAddress);

      if (existingRow) {
        await ctx.db
          .update(taskDropSubscriptions)
          .set({
            agentAddress: input.source === 'agent_setup' ? (input.walletAddress ?? null) : null,
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
          taskDropId: input.taskDropId,
        };
      }

      const id = randomUUID();
      try {
        await ctx.db.insert(taskDropSubscriptions).values({
          id,
          agentAddress: input.source === 'agent_setup' ? (input.walletAddress ?? null) : null,
          email: input.email,
          source: input.source,
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
              eq(taskDropSubscriptions.email, input.email)
            )
          )
          .limit(1);
        const concurrentSubscription = concurrentRows[0];

        if (!concurrentSubscription || concurrentSubscription.status !== 'active') throw error;

        return {
          alreadySubscribed: true,
          email: concurrentSubscription.email,
          subscribed: true,
          taskDropId: input.taskDropId,
        };
      }

      void sendTaskDropsWelcome({
        db: ctx.db,
        subscription: { email: input.email, id, status: 'active', taskDropId: input.taskDropId },
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
            eq(taskDropSubscriptions.email, input.email),
            eq(taskDropSubscriptions.status, 'active')
          )
        )
        .limit(1);

      const row = rows[0];
      return {
        subscribed: Boolean(row),
        taskDropId: input.taskDropId,
      };
    }),
});
