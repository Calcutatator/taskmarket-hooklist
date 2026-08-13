import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { agents, tasks } from '../db/schema';
import { sql } from 'drizzle-orm';
import { taskDiscoverableSql } from '../lib/task-visibility';
import { discoverableOpenTaskCondition } from '../lib/task-discovery';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const marketRouter = router({
  stats: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/market/stats',
        tags: ['Market'],
        summary: 'Get platform-wide market stats',
      },
    })
    .input(z.object({}))
    .output(
      z.object({
        registeredWorkers: z.number(),
        activeWorkers7d: z.number(),
        activeAgents7d: z.number(),
        openTasks: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      // Interpolated as an ISO string, not a raw Date -- when a parameter only
      // appears inside nested UNION branches of a raw sql`(...)` FROM-clause
      // fragment like this, postgres.js/drizzle can't infer a concrete bind
      // type from context and falls back to a path that requires a string or
      // Buffer, crashing on a bare Date with "Received an instance of Date".
      // An ISO string round-trips through Postgres's own timestamptz parsing
      // instead of relying on that inference.
      const since = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
      const now = new Date();

      // Scan recent public task activity once for both activity metrics. The
      // existing worker count remains case-sensitive and includes unregistered
      // workers; the new agent count normalizes addresses and joins against the
      // registry before counting requesters and workers together.
      const [registeredWorkersResult, openTasksResult, activeActivityResult] = await Promise.all([
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(agents),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(tasks)
          .where(discoverableOpenTaskCondition(now)),
        ctx.db
          .select({
            activeAgents7d: sql<number>`(
                count(distinct lower(active_activity.agent_address))
                filter (where ${agents.address} is not null)
              )::int`,
            activeWorkers7d: sql<number>`(
                count(distinct active_activity.agent_address)
                filter (where active_activity.is_worker)
              )::int`,
          })
          .from(
            sql`(
            select t.requester as agent_address, false as is_worker from tasks t
              where t.created_at >= ${since} and ${taskDiscoverableSql}
            union all
            select s.worker_address as agent_address, true as is_worker
              from submissions s join tasks t on t.id = s.task_id
              where s.submitted_at >= ${since} and ${taskDiscoverableSql}
            union all
            select p.worker_address as agent_address, true as is_worker
              from proposals p join tasks t on t.id = p.task_id
              where p.submitted_at >= ${since} and ${taskDiscoverableSql}
            union all
            select pr.worker_address as agent_address, true as is_worker
              from proofs pr join tasks t on t.id = pr.task_id
              where pr.submitted_at >= ${since} and ${taskDiscoverableSql}
            union all
            select c.worker_address as agent_address, true as is_worker
              from claims c join tasks t on t.id = c.task_id
              where c.claimed_at >= ${since} and ${taskDiscoverableSql}
            union all
            select b.worker_address as agent_address, true as is_worker
              from bids b join tasks t on t.id = b.task_id
              where b.created_at >= ${since} and ${taskDiscoverableSql}
          ) as active_activity`
          )
          .leftJoin(agents, sql`lower(${agents.address}) = lower(active_activity.agent_address)`),
      ]);

      return {
        registeredWorkers: Number(registeredWorkersResult[0]?.count ?? 0),
        activeWorkers7d: Number(activeActivityResult[0]?.activeWorkers7d ?? 0),
        activeAgents7d: Number(activeActivityResult[0]?.activeAgents7d ?? 0),
        openTasks: Number(openTasksResult[0]?.count ?? 0),
      };
    }),
});
