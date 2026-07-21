import { sql } from 'drizzle-orm';
import type { db as Database } from '../db/client';
import { agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { taskNotUnlistedSql } from '../lib/task-visibility';
import type {
  PlatformTimeSeriesInput,
  PlatformTimeSeriesResponse,
  AgentTimeSeriesInput,
  AgentTimeSeriesResponse,
  BreakdownsResponse,
  ActivityFeedInput,
  ActivityFeedResponse,
  ActivityType,
  ActivityHeatmapInput,
  ActivityHeatmapResponse,
} from '@taskmarket/shared';

type DB = typeof Database;

/**
 * Stats service.
 *
 * One exported async function per stats procedure holding the Drizzle `sql`
 * queries. All time-series queries gap-fill against a `generate_series` spine
 * so empty buckets coalesce to 0 (no broken chart lines). All bucketing is UTC.
 * Money columns (numeric(78,0) base units) are always returned as strings.
 */

// Map a range enum to a Postgres interval literal. 'all' is handled separately
// by deriving the spine start from the earliest relevant timestamp.
const RANGE_INTERVAL: Record<'7d' | '30d' | '90d', string> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
};

// The five engagement tables that define "active" workers, with their
// respective timestamp columns. Reused (bucketed) from market.stats.
const ACTIVITY_SOURCES: { table: string; tsColumn: string }[] = [
  { table: 'submissions', tsColumn: 'submitted_at' },
  { table: 'proposals', tsColumn: 'submitted_at' },
  { table: 'proofs', tsColumn: 'submitted_at' },
  { table: 'claims', tsColumn: 'claimed_at' },
  { table: 'bids', tsColumn: 'created_at' },
];

function bucketTruncExpr(column: string, bucket: 'day' | 'week') {
  // date_trunc on the UTC-normalised timestamp. Timestamps are stored in UTC,
  // so AT TIME ZONE 'UTC' keeps bucketing deterministic regardless of server TZ.
  return sql.raw(`date_trunc('${bucket}', ${column} AT TIME ZONE 'UTC')`);
}

// ---------------------------------------------------------------------------
// platformTimeSeries
// ---------------------------------------------------------------------------

export async function getPlatformTimeSeries(
  db: DB,
  input: PlatformTimeSeriesInput
): Promise<PlatformTimeSeriesResponse> {
  const { range, bucket } = input;

  // The active-workers UNION, bucketed: each engagement table contributes
  // (worker_address, bucket) so a worker is counted once per bucket via
  // count(distinct worker_address).
  const activeUnion = sql.raw(
    ACTIVITY_SOURCES.map(
      (s) =>
        `select worker_address, date_trunc('${bucket}', ${s.tsColumn} AT TIME ZONE 'UTC') as bucket from ${s.table}`
    ).join(' union all ')
  );

  // Spine start: for fixed ranges, now - interval; for 'all', the earliest
  // relevant timestamp across all metric source columns (so generate_series
  // cannot explode). date_trunc keeps the spine aligned to bucket boundaries.
  const startExpr =
    range === 'all'
      ? sql`date_trunc(${bucket}, coalesce((
          select min(ts) from (
            select min(created_at) as ts from tasks
            union all
            select min(created_at) from feedbacks
            union all
            select min(created_at) from agents
            union all
            select min(submitted_at) from submissions
            union all
            select min(submitted_at) from proposals
            union all
            select min(submitted_at) from proofs
            union all
            select min(claimed_at) from claims
            union all
            select min(created_at) from bids
          ) as mins
        ), date_trunc(${bucket}, now() at time zone 'UTC')) at time zone 'UTC')`
      : sql`date_trunc(${bucket}, (now() at time zone 'UTC') - ${sql.raw(`interval '${RANGE_INTERVAL[range]}'`)})`;

  const bucketStep = sql.raw(`interval '1 ${bucket}'`);

  const query = sql`
    with spine as (
      select generate_series(
        ${startExpr},
        date_trunc(${bucket}, now() at time zone 'UTC'),
        ${bucketStep}
      ) as bucket
    ),
    tasks_created as (
      select ${bucketTruncExpr('created_at', bucket)} as bucket, count(*)::int as c
      from tasks where ${taskNotUnlistedSql} group by 1
    ),
    reward_volume as (
      select ${bucketTruncExpr('created_at', bucket)} as bucket,
             coalesce(sum(reward), 0)::text as v
      from tasks where ${taskNotUnlistedSql} group by 1
    ),
    completed as (
      select ${bucketTruncExpr('f.created_at', bucket)} as bucket, count(*)::int as c
      from feedbacks f
      join tasks t on t.id = f.task_id
      where ${taskNotUnlistedSql}
      group by 1
    ),
    new_agents as (
      select ${bucketTruncExpr('created_at', bucket)} as bucket, count(*)::int as c
      from agents where created_at is not null group by 1
    ),
    active_agents as (
      select bucket, count(distinct worker_address)::int as c
      from (${activeUnion}) as au
      group by 1
    )
    select
      to_char(s.bucket, 'YYYY-MM-DD') as bucket,
      coalesce(tc.c, 0) as "tasksCreated",
      coalesce(rv.v, '0') as "rewardVolume",
      coalesce(cp.c, 0) as "completedTasks",
      coalesce(na.c, 0) as "newAgents",
      coalesce(aa.c, 0) as "activeAgents"
    from spine s
    left join tasks_created tc on tc.bucket = s.bucket
    left join reward_volume rv on rv.bucket = s.bucket
    left join completed cp on cp.bucket = s.bucket
    left join new_agents na on na.bucket = s.bucket
    left join active_agents aa on aa.bucket = s.bucket
    order by s.bucket asc
  `;

  const rows = (await db.execute(query)) as unknown as Array<{
    bucket: string;
    tasksCreated: number;
    rewardVolume: string;
    completedTasks: number;
    newAgents: number;
    activeAgents: number;
  }>;

  return rows.map((r) => ({
    bucket: r.bucket,
    tasksCreated: Number(r.tasksCreated),
    rewardVolume: String(r.rewardVolume),
    completedTasks: Number(r.completedTasks),
    newAgents: Number(r.newAgents),
    activeAgents: Number(r.activeAgents),
  }));
}

// ---------------------------------------------------------------------------
// agentTimeSeries
// ---------------------------------------------------------------------------

export async function getAgentTimeSeries(
  db: DB,
  input: AgentTimeSeriesInput
): Promise<AgentTimeSeriesResponse> {
  const { range, bucket } = input;

  // Resolve agentId -> address the same way agents.router does.
  let address = input.address ?? null;
  if (!address && input.agentId) {
    const resolved = await db
      .select({ address: agents.address })
      .from(agents)
      .where(eq(agents.agentId, input.agentId))
      .limit(1);
    address = resolved[0]?.address ?? null;
  }

  // Unknown agent: return an empty series rather than throwing, so charts can
  // render an empty state.
  if (!address) {
    return [];
  }

  const startExpr =
    range === 'all'
      ? sql`date_trunc(${bucket}, coalesce((
          select min(ts) from (
            select min(f.created_at) as ts from feedbacks f where f.worker_address = ${address}
            union all
            select min(s.submitted_at) from submissions s where s.worker_address = ${address}
            union all
            select min(p.submitted_at) from proposals p where p.worker_address = ${address}
            union all
            select min(pr.submitted_at) from proofs pr where pr.worker_address = ${address}
            union all
            select min(c.claimed_at) from claims c where c.worker_address = ${address}
            union all
            select min(b.created_at) from bids b where b.worker_address = ${address}
          ) as mins
        ), date_trunc(${bucket}, now() at time zone 'UTC')) at time zone 'UTC')`
      : sql`date_trunc(${bucket}, (now() at time zone 'UTC') - ${sql.raw(`interval '${RANGE_INTERVAL[range]}'`)})`;

  const bucketStep = sql.raw(`interval '1 ${bucket}'`);

  // Activity union with the worker bound via a parameter. Built as one SELECT
  // per source so the address parameter is safely bound (no raw interpolation).
  const activityUnion = sql.join(
    ACTIVITY_SOURCES.map(
      (s) =>
        sql`select ${bucketTruncExpr(s.tsColumn, bucket)} as bucket from ${sql.raw(s.table)} where worker_address = ${address}`
    ),
    sql` union all `
  );

  const query = sql`
    with spine as (
      select generate_series(
        ${startExpr},
        date_trunc(${bucket}, now() at time zone 'UTC'),
        ${bucketStep}
      ) as bucket
    ),
    earnings as (
      select ${bucketTruncExpr('f.created_at', bucket)} as bucket,
             coalesce(sum(t.reward), 0)::text as v
      from feedbacks f
      join tasks t on t.id = f.task_id
      where f.worker_address = ${address} and ${taskNotUnlistedSql}
      group by 1
    ),
    completed as (
      select ${bucketTruncExpr('created_at', bucket)} as bucket, count(*)::int as c
      from feedbacks where worker_address = ${address} group by 1
    ),
    ratings as (
      select ${bucketTruncExpr('created_at', bucket)} as bucket,
             avg(rating)::float as avg_rating,
             count(*)::int as cnt
      from feedbacks where worker_address = ${address} group by 1
    ),
    activity as (
      select bucket, count(*)::int as c
      from (${activityUnion}) as au
      group by 1
    )
    select
      to_char(s.bucket, 'YYYY-MM-DD') as bucket,
      coalesce(e.v, '0') as earnings,
      coalesce(cp.c, 0) as "tasksCompleted",
      r.avg_rating as "avgRating",
      coalesce(r.cnt, 0) as "ratingsCount",
      coalesce(ac.c, 0) as "activityCount"
    from spine s
    left join earnings e on e.bucket = s.bucket
    left join completed cp on cp.bucket = s.bucket
    left join ratings r on r.bucket = s.bucket
    left join activity ac on ac.bucket = s.bucket
    order by s.bucket asc
  `;

  const rows = (await db.execute(query)) as unknown as Array<{
    bucket: string;
    earnings: string;
    tasksCompleted: number;
    avgRating: number | null;
    ratingsCount: number;
    activityCount: number;
  }>;

  // cumulativeEarnings is computed in JS over the gap-filled, ordered rows so it
  // is a true running total of base-unit strings (BigInt-safe, never a float).
  let running = 0n;
  return rows.map((r) => {
    running += BigInt(r.earnings ?? '0');
    return {
      bucket: r.bucket,
      earnings: String(r.earnings ?? '0'),
      cumulativeEarnings: running.toString(),
      tasksCompleted: Number(r.tasksCompleted),
      avgRating: r.avgRating === null || r.avgRating === undefined ? null : Number(r.avgRating),
      ratingsCount: Number(r.ratingsCount),
      activityCount: Number(r.activityCount),
    };
  });
}

// ---------------------------------------------------------------------------
// breakdowns
// ---------------------------------------------------------------------------

export async function getBreakdowns(db: DB): Promise<BreakdownsResponse> {
  const query = sql`
    select 'status' as kind, status as key, count(*)::int as c
    from tasks where ${taskNotUnlistedSql} group by status
    union all
    select 'mode' as kind, mode as key, count(*)::int as c
    from tasks where ${taskNotUnlistedSql} group by mode
    union all
    select 'actorType' as kind,
           case when registered_via = 'web' then 'human' else 'agent' end as key,
           count(*)::int as c
    from agents group by case when registered_via = 'web' then 'human' else 'agent' end
  `;

  const rows = (await db.execute(query)) as unknown as Array<{
    kind: string;
    key: string;
    c: number;
  }>;

  const status: { status: string; count: number }[] = [];
  const mode: { mode: string; count: number }[] = [];
  const actorType: { actorType: 'human' | 'agent'; count: number }[] = [];

  for (const row of rows) {
    if (row.kind === 'status') {
      status.push({ status: row.key, count: Number(row.c) });
    } else if (row.kind === 'mode') {
      mode.push({ mode: row.key, count: Number(row.c) });
    } else if (row.kind === 'actorType') {
      actorType.push({ actorType: row.key as 'human' | 'agent', count: Number(row.c) });
    }
  }

  return { status, mode, actorType };
}

// ---------------------------------------------------------------------------
// activityFeed
// ---------------------------------------------------------------------------

const ALL_ACTIVITY_TYPES: ActivityType[] = [
  'task_created',
  'task_submitted',
  'task_claimed',
  'task_pitched',
  'bid_placed',
  'task_rated',
];

export async function getActivityFeed(
  db: DB,
  input: ActivityFeedInput
): Promise<ActivityFeedResponse> {
  const { limit } = input;
  const cursor = input.cursor ?? null;
  const types = input.types && input.types.length > 0 ? input.types : ALL_ACTIVITY_TYPES;
  const typeSet = new Set<ActivityType>(types);

  // Each source maps a domain table to an activity-feed row. taskTitle is the
  // first line of the task description, sliced to ~80 chars (done in SQL via
  // split_part + left). actorType resolves via a left join to agents.
  const sources: { type: ActivityType; sql: ReturnType<typeof sql> }[] = [];

  // Every source below joins tasks and is filtered to task_visibility != 'unlisted' --
  // this feed streams per-task description/reward/actor to the public, a bigger
  // per-task leak than a browse listing, so it must respect visibility too.
  if (typeSet.has('task_created')) {
    sources.push({
      type: 'task_created',
      sql: sql`
        select 'task_created' as type, t.created_at as ts, t.id as task_id,
               t.description as descr, t.requester as actor,
               t.reward::text as amount, null::int as rating
        from tasks t where ${taskNotUnlistedSql}`,
    });
  }
  if (typeSet.has('task_submitted')) {
    sources.push({
      type: 'task_submitted',
      sql: sql`
        select 'task_submitted' as type, s.submitted_at as ts, s.task_id as task_id,
               t.description as descr, s.worker_address as actor,
               null::text as amount, null::int as rating
        from submissions s join tasks t on t.id = s.task_id
        where ${taskNotUnlistedSql}`,
    });
  }
  if (typeSet.has('task_claimed')) {
    sources.push({
      type: 'task_claimed',
      sql: sql`
        select 'task_claimed' as type, c.claimed_at as ts, c.task_id as task_id,
               t.description as descr, c.worker_address as actor,
               c.stake_amount::text as amount, null::int as rating
        from claims c join tasks t on t.id = c.task_id
        where ${taskNotUnlistedSql}`,
    });
  }
  if (typeSet.has('task_pitched')) {
    sources.push({
      type: 'task_pitched',
      sql: sql`
        select 'task_pitched' as type, p.submitted_at as ts, p.task_id as task_id,
               t.description as descr, p.worker_address as actor,
               null::text as amount, null::int as rating
        from proposals p join tasks t on t.id = p.task_id
        where ${taskNotUnlistedSql}`,
    });
  }
  if (typeSet.has('bid_placed')) {
    sources.push({
      type: 'bid_placed',
      sql: sql`
        select 'bid_placed' as type, b.created_at as ts, b.task_id as task_id,
               t.description as descr, b.worker_address as actor,
               b.price::text as amount, null::int as rating
        from bids b join tasks t on t.id = b.task_id
        where ${taskNotUnlistedSql}`,
    });
  }
  if (typeSet.has('task_rated')) {
    sources.push({
      type: 'task_rated',
      sql: sql`
        select 'task_rated' as type, f.created_at as ts, f.task_id as task_id,
               t.description as descr, f.requester_address as actor,
               null::text as amount, f.rating::int as rating
        from feedbacks f join tasks t on t.id = f.task_id
        where ${taskNotUnlistedSql}`,
    });
  }

  // No types selected (impossible given default, but defensive).
  if (sources.length === 0) {
    return { items: [], nextCursor: null };
  }

  const unionAll = sql.join(
    sources.map((s) => s.sql),
    sql` union all `
  );

  // Keyset pagination on timestamp (same style as tasks.list createdAt cursor):
  // WHERE ts < cursor, fetch limit + 1 to compute nextCursor. cursor is
  // already an ISO string (nextCursor is generated via .toISOString()) --
  // interpolate it directly rather than round-tripping through `new Date()`.
  // When a parameter only appears against a UNION-derived virtual column
  // like e.ts (not a directly-typed physical column), postgres.js/drizzle
  // can't infer a concrete bind type from context and crashes on a bare
  // Date ("Received an instance of Date") the same way market.router.ts's
  // stats query did -- an ISO string round-trips through Postgres's own
  // timestamptz parsing instead of relying on that inference.
  const cursorClause = cursor ? sql`where e.ts < ${cursor}` : sql``;

  const query = sql`
    with events as (${unionAll})
    select
      e.type as type,
      e.ts as ts,
      e.task_id as "taskId",
      left(split_part(e.descr, E'\n', 1), 80) as "taskTitle",
      e.actor as actor,
      case when ag.registered_via = 'web' then 'human' else 'agent' end as "actorType",
      e.amount as amount,
      e.rating as rating
    from events e
    left join agents ag on ag.address = e.actor
    ${cursorClause}
    order by e.ts desc
    limit ${limit + 1}
  `;

  const rows = (await db.execute(query)) as unknown as Array<{
    type: ActivityType;
    ts: Date | string;
    taskId: string;
    taskTitle: string | null;
    actor: string;
    actorType: 'human' | 'agent';
    amount: string | null;
    rating: number | null;
  }>;

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const items = pageRows.map((r) => {
    const ts = r.ts instanceof Date ? r.ts : new Date(r.ts);
    return {
      type: r.type,
      timestamp: ts.toISOString(),
      taskId: r.taskId,
      taskTitle: r.taskTitle && r.taskTitle.length > 0 ? r.taskTitle : null,
      actor: r.actor,
      actorType: r.actorType,
      amount: r.amount === null || r.amount === undefined ? null : String(r.amount),
      rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
    };
  });

  const nextCursor = hasMore ? items[items.length - 1]!.timestamp : null;

  return { items, nextCursor };
}

// ---------------------------------------------------------------------------
// activityHeatmap
// ---------------------------------------------------------------------------

// The task modes that form the rows of the 'mode' heat map.
const HEATMAP_MODES = ['bounty', 'claim', 'pitch', 'benchmark', 'auction'] as const;

export async function getActivityHeatmap(
  db: DB,
  input: ActivityHeatmapInput
): Promise<ActivityHeatmapResponse> {
  const { range, dimension } = input;

  if (dimension === 'hourOfWeek') {
    // Union the engagement source tables and bucket each row by (day-of-week,
    // hour-of-day) in UTC. count = activity count; volume is not meaningful for
    // this dimension so it is returned as '0'. created_at is guarded null for the
    // bids source (the only source whose timestamp column is nullable in spirit);
    // all sources are filtered `ts is not null` for safety.
    const rangeClause =
      range === 'all'
        ? ''
        : ` where ts >= (now() at time zone 'UTC') - interval '${RANGE_INTERVAL[range]}'`;

    const tsUnion = sql.raw(
      ACTIVITY_SOURCES.map(
        (s) => `select ${s.tsColumn} as ts from ${s.table} where ${s.tsColumn} is not null`
      ).join(' union all ')
    );

    const query = sql`
      with events as (${tsUnion})
      select
        extract(dow from ts at time zone 'UTC')::int as row,
        extract(hour from ts at time zone 'UTC')::int as col,
        count(*)::int as c
      from events
      ${sql.raw(rangeClause)}
      group by 1, 2
    `;

    const rows = (await db.execute(query)) as unknown as Array<{
      row: number;
      col: number;
      c: number;
    }>;

    const rowKeys = ['0', '1', '2', '3', '4', '5', '6'];
    const colKeys = Array.from({ length: 24 }, (_, h) => String(h));

    let maxCount = 0;
    const cells = rows.map((r) => {
      const count = Number(r.c);
      if (count > maxCount) {
        maxCount = count;
      }
      return {
        row: String(r.row),
        col: String(r.col),
        count,
        volume: '0',
      };
    });

    return { rowKeys, colKeys, cells, maxCount };
  }

  // dimension === 'mode': group tasks by (mode, day bucket) over the range.
  // count = task count, volume = sum(reward) as base-unit text. colKeys are the
  // ordered day buckets generated from a spine so the range is fully covered.
  const startExpr =
    range === 'all'
      ? sql`date_trunc('day', coalesce(
          (select min(created_at) from tasks where created_at is not null),
          date_trunc('day', now() at time zone 'UTC')
        ) at time zone 'UTC')`
      : sql`date_trunc('day', (now() at time zone 'UTC') - ${sql.raw(`interval '${RANGE_INTERVAL[range]}'`)})`;

  const rangeClause =
    range === 'all'
      ? sql``
      : sql`and created_at >= (now() at time zone 'UTC') - ${sql.raw(`interval '${RANGE_INTERVAL[range]}'`)}`;

  const query = sql`
    with spine as (
      select generate_series(
        ${startExpr},
        date_trunc('day', now() at time zone 'UTC'),
        interval '1 day'
      ) as bucket
    ),
    cells as (
      select
        mode as row,
        ${bucketTruncExpr('created_at', 'day')} as bucket,
        count(*)::int as c,
        coalesce(sum(reward), 0)::text as v
      from tasks
      where created_at is not null and ${taskNotUnlistedSql}
      ${rangeClause}
      group by 1, 2
    )
    select
      to_char(s.bucket, 'YYYY-MM-DD') as col,
      c.row as row,
      coalesce(c.c, 0) as c,
      coalesce(c.v, '0') as v
    from spine s
    left join cells c on c.bucket = s.bucket
    order by s.bucket asc
  `;

  const rows = (await db.execute(query)) as unknown as Array<{
    col: string;
    row: string | null;
    c: number;
    v: string;
  }>;

  // colKeys: the ordered, de-duplicated day buckets from the spine.
  const colKeys: string[] = [];
  const seenCols = new Set<string>();
  for (const r of rows) {
    if (!seenCols.has(r.col)) {
      seenCols.add(r.col);
      colKeys.push(r.col);
    }
  }

  // Only emit non-empty cells (spine rows with no matching task have row = null).
  let maxCount = 0;
  const cells = rows
    .filter((r) => r.row !== null && Number(r.c) > 0)
    .map((r) => {
      const count = Number(r.c);
      if (count > maxCount) {
        maxCount = count;
      }
      return {
        row: String(r.row),
        col: r.col,
        count,
        volume: String(r.v),
      };
    });

  return {
    rowKeys: [...HEATMAP_MODES],
    colKeys,
    cells,
    maxCount,
  };
}
