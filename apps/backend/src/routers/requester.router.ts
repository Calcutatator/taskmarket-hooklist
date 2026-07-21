import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { tasks, submissions, requesterReputationEvents } from '../db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { taskNotUnlisted } from '../lib/task-visibility';

export const requesterRouter = router({
  stats: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/requester/{address}/stats',
        tags: ['Requester'],
        summary: 'Get requester reputation stats',
      },
    })
    .input(z.object({ address: z.string() }))
    .output(
      z.object({
        completedCount: z.number(),
        selfAwardCount: z.number(),
        cancelledAfterSubmissionsCount: z.number(),
        expiredNoActionCount: z.number(),
        expiredAfterRejectionsCount: z.number(),
        totalTasksCreated: z.number(),
        totalSubmissionAttempts: z.number(),
        totalUniqueWorkers: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      const addr = input.address.toLowerCase();

      const [reputationRows, totalTasksRow, uniqueWorkersRow] = await Promise.all([
        ctx.db
          .select({
            eventType: requesterReputationEvents.eventType,
            selfAward: requesterReputationEvents.selfAward,
            submissionCount: requesterReputationEvents.submissionCount,
          })
          .from(requesterReputationEvents)
          .where(sql`lower(${requesterReputationEvents.requester}) = ${addr}`),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(tasks)
          .where(and(sql`lower(${tasks.requester}) = ${addr}`, taskNotUnlisted)),
        ctx.db
          .select({ count: sql<number>`count(distinct ${submissions.workerAddress})` })
          .from(submissions)
          .innerJoin(
            tasks,
            and(eq(submissions.taskId, tasks.id), sql`lower(${tasks.requester}) = ${addr}`)
          )
          .where(sql`${submissions.rejectedAt} IS NULL`),
      ]);

      let completedCount = 0;
      let selfAwardCount = 0;
      let cancelledAfterSubmissionsCount = 0;
      let expiredNoActionCount = 0;
      let expiredAfterRejectionsCount = 0;
      let totalSubmissionAttempts = 0;

      for (const row of reputationRows) {
        totalSubmissionAttempts += row.submissionCount ?? 0;
        switch (row.eventType) {
          case 'completed':
            completedCount++;
            if (row.selfAward) selfAwardCount++;
            break;
          case 'cancelled_after_submissions':
            cancelledAfterSubmissionsCount++;
            break;
          case 'expired_no_action':
            expiredNoActionCount++;
            break;
          case 'expired_after_rejections':
            expiredAfterRejectionsCount++;
            break;
        }
      }

      return {
        completedCount,
        selfAwardCount,
        cancelledAfterSubmissionsCount,
        expiredNoActionCount,
        expiredAfterRejectionsCount,
        totalTasksCreated: Number(totalTasksRow[0]?.count ?? 0),
        totalSubmissionAttempts,
        totalUniqueWorkers: Number(uniqueWorkersRow[0]?.count ?? 0),
      };
    }),
});
