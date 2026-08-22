import {
  HookGetInputSchema,
  HookIndexEntrySchema,
  HookIndexInputSchema,
  HookIndexResponseSchema,
  type HookIndexEntry,
  type HookIndexResponse,
} from '@taskmarket/shared';
import { inArray, sql, type SQL } from 'drizzle-orm';

import type { Context } from '../context';
import { tasks } from '../db/schema';
import {
  TASK_PHASE_IN_REVIEW_STATUSES,
  TASK_PHASE_RESOLVED_STATUSES,
  TASK_PHASE_SUBMISSION_WINDOW_STATUSES,
} from '../lib/task';
import { taskDiscoverable } from '../lib/task-visibility';
import { publicProcedure, router } from '../trpc';

const addressPattern = '^0x[0-9a-fA-F]{40}$';
const zeroAddress = '0x0000000000000000000000000000000000000000';
const taskModes = ['bounty', 'claim', 'pitch', 'benchmark', 'auction'] as const;
const taskIdsPerHook = 8;

type HookAggregateRow = {
  address: string;
  activePhaseTaskCount: number | string;
  modes: string[];
  taskCount: number | string;
  taskIds: string[];
};

type HookAggregateQueryOptions = {
  address?: string;
  limit: number;
  now: Date;
};

/**
 * SQL equivalent of computeTaskPhase(task, now) === 'active'. The status groups are exported by
 * lib/task.ts and consumed by computeTaskPhase itself, so the database projection cannot grow a
 * second, independently-maintained set of lifecycle buckets.
 */
function activeTaskPhaseSql(now: Date): SQL<boolean> {
  return sql<boolean>`case
    when ${inArray(tasks.status, [...TASK_PHASE_IN_REVIEW_STATUSES])} then false
    when ${inArray(tasks.status, [...TASK_PHASE_RESOLVED_STATUSES])} then false
    when ${inArray(tasks.status, [...TASK_PHASE_SUBMISSION_WINDOW_STATUSES])}
      then ${tasks.expiryTime} > ${now}
    else true
  end`;
}

function buildHookAggregateQuery({ address, limit, now }: HookAggregateQueryOptions): SQL {
  const addressCondition = address
    ? sql`and lower(${tasks.hookContract}) = ${address.toLowerCase()}`
    : sql``;

  return sql`
    with hook_tasks as (
      select
        lower(${tasks.hookContract}) as address,
        ${tasks.id} as id,
        ${tasks.mode} as mode,
        ${tasks.createdAt} as created_at,
        ${activeTaskPhaseSql(now)} as active_phase,
        ${inArray(tasks.mode, [...taskModes])} as known_mode,
        row_number() over (
          partition by lower(${tasks.hookContract})
          order by ${tasks.createdAt} desc, ${tasks.id} asc
        ) as task_id_rank
      from ${tasks}
      where ${taskDiscoverable}
        and ${tasks.hookContract} is not null
        and ${tasks.hookContract} ~ ${addressPattern}
        and lower(${tasks.hookContract}) <> ${zeroAddress}
        ${addressCondition}
    ),
    hook_aggregates as (
      select
        address,
        count(*)::int as "taskCount",
        (count(*) filter (where active_phase))::int as "activePhaseTaskCount",
        coalesce(
          array_agg(distinct mode order by mode) filter (where known_mode),
          array[]::text[]
        ) as modes,
        coalesce(
          array_agg(id order by created_at desc, id asc) filter (
            where task_id_rank <= ${taskIdsPerHook}
          ),
          array[]::text[]
        ) as "taskIds"
      from hook_tasks
      group by address
    )
    select address, "activePhaseTaskCount", modes, "taskCount", "taskIds"
    from hook_aggregates
    order by "taskCount" desc, address asc
    limit ${limit}
  `;
}

function serializeHookAggregate(row: HookAggregateRow): HookIndexEntry {
  return HookIndexEntrySchema.parse({
    address: row.address.toLowerCase(),
    activePhaseTaskCount: Number(row.activePhaseTaskCount),
    modes: row.modes,
    taskCount: Number(row.taskCount),
    // The SQL rank already applies this bound. Keep the slice as a final response invariant if a
    // non-Postgres test double or future driver ever returns an invalid aggregate.
    taskIds: row.taskIds.slice(0, taskIdsPerHook),
  });
}

async function queryHookAggregates(
  db: Context['db'],
  options: HookAggregateQueryOptions
): Promise<HookIndexEntry[]> {
  const rows = (await db.execute(
    buildHookAggregateQuery(options)
  )) as unknown as HookAggregateRow[];
  return rows.map(serializeHookAggregate);
}

/**
 * Public views of the current `tasks.hook_contract` projection. That column retains one effective
 * observed hook per task, so these endpoints intentionally do not claim an ordered on-chain
 * multi-hook history or any source, security, listing, or protocol-default evidence. Active-phase
 * counts mirror computeTaskPhase and exclude review, appeal, dispute, expired-awaiting-settlement,
 * and resolved tasks.
 */
export const hooksRouter = router({
  list: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/hooks',
        tags: ['Hooks'],
        summary: 'List observed hooks and current active-phase task counts',
      },
    })
    .input(HookIndexInputSchema)
    .output(HookIndexResponseSchema)
    .query(async ({ input, ctx }) => {
      const rows = await queryHookAggregates(ctx.db, {
        limit: input.limit + 1,
        now: new Date(),
      });
      const hasMore = rows.length > input.limit;

      return {
        hooks: hasMore ? rows.slice(0, input.limit) : rows,
        hasMore,
        observation: 'current-task-projection-one-effective-hook-per-task' as const,
      } satisfies HookIndexResponse;
    }),

  get: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/hooks/{address}',
        tags: ['Hooks'],
        summary: 'Get one observed hook by address',
      },
    })
    .input(HookGetInputSchema)
    .output(HookIndexEntrySchema.nullable())
    .query(async ({ input, ctx }) => {
      const rows = await queryHookAggregates(ctx.db, {
        address: input.address,
        limit: 1,
        now: new Date(),
      });
      return rows[0] ?? null;
    }),
});
