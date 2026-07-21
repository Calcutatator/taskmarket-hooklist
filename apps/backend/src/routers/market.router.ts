import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { agents, tasks } from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { taskNotUnlisted, taskNotUnlistedSql } from '../lib/task-visibility';

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
        openTasks: z.number(),
      })
    )
    .query(async ({ ctx }) => {
      const since = new Date(Date.now() - SEVEN_DAYS_MS);

      // Count distinct worker addresses active in the last 7 days across all five
      // engagement tables. UNION dedupes addresses that appear in more than one
      // table, so the outer count(distinct) counts each worker exactly once.
      const [registeredWorkersResult, openTasksResult, activeWorkersResult] = await Promise.all([
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(agents),
        ctx.db
          .select({ count: sql<number>`count(*)::int` })
          .from(tasks)
          .where(and(eq(tasks.status, 'open'), taskNotUnlisted)),
        ctx.db
          .select({ count: sql<number>`count(distinct active_workers.worker_address)::int` })
          .from(
            sql`(
            select s.worker_address from submissions s join tasks t on t.id = s.task_id
              where s.submitted_at >= ${since} and ${taskNotUnlistedSql}
            union
            select p.worker_address from proposals p join tasks t on t.id = p.task_id
              where p.submitted_at >= ${since} and ${taskNotUnlistedSql}
            union
            select pr.worker_address from proofs pr join tasks t on t.id = pr.task_id
              where pr.submitted_at >= ${since} and ${taskNotUnlistedSql}
            union
            select c.worker_address from claims c join tasks t on t.id = c.task_id
              where c.claimed_at >= ${since} and ${taskNotUnlistedSql}
            union
            select b.worker_address from bids b join tasks t on t.id = b.task_id
              where b.created_at >= ${since} and ${taskNotUnlistedSql}
          ) as active_workers`
          ),
      ]);

      return {
        registeredWorkers: Number(registeredWorkersResult[0]?.count ?? 0),
        activeWorkers7d: Number(activeWorkersResult[0]?.count ?? 0),
        openTasks: Number(openTasksResult[0]?.count ?? 0),
      };
    }),
});
