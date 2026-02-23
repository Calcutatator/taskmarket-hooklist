import { router, publicProcedure } from '../trpc';
import { SubmissionCreateSchema, SubmissionResponseSchema } from '@taskmarket/shared';
import { z } from 'zod';
import { submissions, tasks, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getStorageBackend } from '../lib/storage';
import { randomUUID } from 'crypto';

export const submissionsRouter = router({
  submit: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/submissions',
        tags: ['Tasks'],
        summary: 'Submit work for a task',
      },
    })
    .input(SubmissionCreateSchema)
    .output(z.object({ success: z.boolean(), submissionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);

      if (taskResult.length === 0) {
        throw new Error('Task not found');
      }

      const task = taskResult[0];

      if (task.mode === 'claim') {
        if (task.status !== 'claimed') {
          throw new Error('Task not claimed');
        }
        if (task.claimedBy !== input.workerAddress) {
          throw new Error('Only claimer can submit');
        }
      } else if (task.mode === 'pitch') {
        if (task.status !== 'worker_selected') {
          throw new Error('Worker not selected');
        }
        if (task.worker !== input.workerAddress) {
          throw new Error('Only selected worker can submit');
        }
      } else if (task.mode === 'auction') {
        if (task.status !== 'claimed') {
          throw new Error('Winner not selected yet');
        }
        if (task.worker !== input.workerAddress) {
          throw new Error('Only winning bidder can submit');
        }
      } else if (task.mode === 'bounty' || task.mode === 'benchmark') {
        if (task.status !== 'open') {
          throw new Error('Task not open for submissions');
        }
      }

      const storage = getStorageBackend();
      const fileKey = `submissions/${input.taskId}/${randomUUID()}`;
      const fileUrl = await storage.upload(fileKey, Buffer.from(input.file, 'base64'));

      const submissionId = randomUUID();

      await ctx.db.insert(submissions).values({
        id: submissionId,
        taskId: input.taskId,
        workerAddress: input.workerAddress,
        fileUrl,
        signature: input.signature,
      });

      if (task.status === 'open') {
        await ctx.db
          .update(tasks)
          .set({ status: 'pending_approval' })
          .where(eq(tasks.id, input.taskId));
      }

      return { success: true, submissionId };
    }),

  listByTask: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/submissions',
        tags: ['Tasks'],
        summary: 'List submissions for a task',
      },
    })
    .input(z.object({ taskId: z.string() }))
    .output(z.array(SubmissionResponseSchema))
    .query(async ({ input, ctx }) => {
      const results = await ctx.db
        .select()
        .from(submissions)
        .where(eq(submissions.taskId, input.taskId));

      const submissionsWithStats = await Promise.all(
        results.map(async (sub) => {
          const agentResult = await ctx.db
            .select()
            .from(agents)
            .where(eq(agents.address, sub.workerAddress))
            .limit(1);

          const agent = agentResult[0];

          return {
            id: sub.id,
            taskId: sub.taskId,
            workerAddress: sub.workerAddress,
            fileUrl: sub.fileUrl,
            signature: sub.signature,
            submittedAt: sub.submittedAt.toISOString(),
            workerAgentId: agent?.agentId ?? null,
            workerStats: agent
              ? {
                  completedTasks: agent.completedTasks,
                  ratedTasks: agent.ratedTasks,
                  totalStars: Number(agent.totalStars),
                  averageRating:
                    agent.ratedTasks > 0 ? Number(agent.totalStars) / agent.ratedTasks : 0,
                }
              : { completedTasks: 0, ratedTasks: 0, totalStars: 0, averageRating: 0 },
          };
        })
      );

      return submissionsWithStats;
    }),

  download: publicProcedure
    .input(z.object({ submissionId: z.string(), acceptanceTxHash: z.string() }))
    .output(z.object({ presignedUrl: z.string() }))
    .query(async ({ input, ctx }) => {
      const result = await ctx.db
        .select()
        .from(submissions)
        .where(eq(submissions.id, input.submissionId))
        .limit(1);

      if (result.length === 0) {
        throw new Error('Submission not found');
      }

      const submission = result[0];

      const taskResult = await ctx.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, submission.taskId))
        .limit(1);

      if (taskResult.length === 0 || taskResult[0].status !== 'accepted') {
        throw new Error('Task not accepted');
      }

      const storage = getStorageBackend();
      const presignedUrl = await storage.getPresignedUrl(submission.fileUrl, 3600);

      return { presignedUrl };
    }),
});
