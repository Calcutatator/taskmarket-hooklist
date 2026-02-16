import { router, publicProcedure } from '../trpc';
import {
  ProposalCreateSchema,
  ProposalResponseSchema,
  ProposalSelectSchema,
} from '@clawtasker/shared';
import { z } from 'zod';
import { proposals, tasks, agents } from '../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const proposalsRouter = router({
  submit: publicProcedure
    .input(ProposalCreateSchema)
    .output(z.object({ success: z.boolean(), proposalId: z.string() }))
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

      if (task.mode !== 'proposal') {
        throw new Error('Not a Proposal task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open for proposals');
      }

      if (task.proposalDeadline && new Date() > task.proposalDeadline) {
        throw new Error('Proposal deadline has passed');
      }

      const existingProposal = await ctx.db
        .select()
        .from(proposals)
        .where(
          and(eq(proposals.taskId, input.taskId), eq(proposals.workerAddress, input.workerAddress))
        )
        .limit(1);

      if (existingProposal.length > 0) {
        throw new Error('Worker has already submitted a proposal');
      }

      const proposalId = randomUUID();

      await ctx.db.insert(proposals).values({
        id: proposalId,
        taskId: input.taskId,
        workerAddress: input.workerAddress,
        proposalText: input.proposalText,
        estimatedDuration: input.estimatedDuration || null,
        signature: input.signature,
        status: 'pending',
      });

      return { success: true, proposalId };
    }),

  listByTask: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .output(z.array(ProposalResponseSchema))
    .query(async ({ input, ctx }) => {
      const results = await ctx.db
        .select()
        .from(proposals)
        .where(eq(proposals.taskId, input.taskId));

      const proposalsWithStats = await Promise.all(
        results.map(async (proposal) => {
          const agentResult = await ctx.db
            .select()
            .from(agents)
            .where(eq(agents.address, proposal.workerAddress))
            .limit(1);

          const agent = agentResult[0];

          return {
            id: proposal.id,
            taskId: proposal.taskId,
            workerAddress: proposal.workerAddress,
            proposalText: proposal.proposalText,
            estimatedDuration: proposal.estimatedDuration,
            status: proposal.status as any,
            submittedAt: proposal.submittedAt.toISOString(),
            workerStats: agent
              ? {
                  completedTasks: agent.completedTasks,
                  averageRating:
                    agent.ratedTasks > 0 ? Number(agent.totalStars) / agent.ratedTasks : null,
                }
              : undefined,
          };
        })
      );

      return proposalsWithStats;
    }),

  select: publicProcedure
    .input(ProposalSelectSchema)
    .output(z.object({ success: z.boolean() }))
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

      if (task.mode !== 'proposal') {
        throw new Error('Not a Proposal task');
      }

      if (task.status !== 'open') {
        throw new Error('Task not open');
      }

      await ctx.db
        .update(proposals)
        .set({ status: 'selected' })
        .where(eq(proposals.id, input.proposalId));

      await ctx.db
        .update(proposals)
        .set({ status: 'rejected' })
        .where(and(eq(proposals.taskId, input.taskId), ne(proposals.id, input.proposalId)));

      await ctx.db
        .update(tasks)
        .set({
          status: 'worker_selected',
          worker: input.workerAddress,
        })
        .where(eq(tasks.id, input.taskId));

      return { success: true };
    }),
});
