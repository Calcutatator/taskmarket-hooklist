import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  VerifyTaskAccessPasswordInputSchema,
  VerifyTaskAccessPasswordResponseSchema,
  AddAllowedViewerInputSchema,
  RemoveAllowedViewerInputSchema,
  ListAllowedViewersInputSchema,
  ListAllowedViewersResponseSchema,
} from '@taskmarket/shared';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { tasks, taskAllowedViewers } from '../db/schema';
import {
  verifyOrDummyTaskAccessPassword,
  enforceTaskAccessPasswordRateLimit,
} from '../lib/task-access-password';
import { issueTaskAccessGrant } from '../lib/task-access-grants';

const GENERIC_ACCESS_ERROR = 'Invalid task or password';

/**
 * Phase 3 (ADR-0030): password verification and wallet-allowlist management for
 * private tasks. Mounted as `taskAccess` in router.ts. Kept as its own router rather
 * than growing the already-large tasks.router.ts further.
 */
export const taskAccessRouter = router({
  verifyPassword: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/private-access/verify',
        tags: ['Tasks'],
        summary: "Verify a private task's password and receive a task-scoped access grant",
      },
    })
    .input(VerifyTaskAccessPasswordInputSchema)
    .output(VerifyTaskAccessPasswordResponseSchema)
    .mutation(async ({ input, ctx }) => {
      // Rate-limited before touching the stored hash at all -- this is a public,
      // unauthenticated endpoint that accepts a raw password guess, so nothing else
      // stops unlimited brute-force attempts against a private task's password.
      try {
        await enforceTaskAccessPasswordRateLimit({ db: ctx.db, taskId: input.taskId });
      } catch (err) {
        if (err instanceof Error && err.name === 'TASK_ACCESS_RATE_LIMITED') {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: err.message });
        }
        throw err;
      }

      const rows = await ctx.db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      const task = rows[0];

      // Always the same generic failure whether the task doesn't exist, isn't private,
      // has no password set, or the password is wrong -- no distinguishing signal,
      // matching the "don't confirm existence" posture used elsewhere in this phase.
      const storedHash =
        task && task.taskVisibility === 'private' ? task.privateAccessPasswordHash : null;
      if (!task || task.taskVisibility !== 'private' || !storedHash) {
        // Still run the dummy comparison so this branch takes the same time as a real
        // wrong-password check (see verifyOrDummyTaskAccessPassword's doc comment).
        verifyOrDummyTaskAccessPassword(input.password, null);
        throw new TRPCError({ code: 'UNAUTHORIZED', message: GENERIC_ACCESS_ERROR });
      }

      if (!verifyOrDummyTaskAccessPassword(input.password, storedHash)) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: GENERIC_ACCESS_ERROR });
      }

      const { grant, expiresAt } = await issueTaskAccessGrant(ctx.db, task.id);
      return { grant, expiresAt: expiresAt.toISOString() };
    }),

  addAllowedViewer: protectedProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/tasks/{taskId}/private-access/viewers',
        tags: ['Tasks'],
        summary: 'Invite a wallet to view a private task (requester only)',
      },
    })
    .input(AddAllowedViewerInputSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const task = await requireOwnedPrivateTask(ctx, input.taskId);
      const viewerAddress = input.viewerAddress.toLowerCase();

      await ctx.db
        .insert(taskAllowedViewers)
        .values({ taskId: task.id, viewerAddress, addedBy: ctx.caller.address })
        .onConflictDoNothing();

      return { success: true };
    }),

  removeAllowedViewer: protectedProcedure
    .meta({
      openapi: {
        method: 'DELETE',
        path: '/tasks/{taskId}/private-access/viewers/{viewerAddress}',
        tags: ['Tasks'],
        summary: "Remove a wallet from a private task's allowlist (requester only)",
      },
    })
    .input(RemoveAllowedViewerInputSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const task = await requireOwnedPrivateTask(ctx, input.taskId);
      const viewerAddress = input.viewerAddress.toLowerCase();

      await ctx.db
        .delete(taskAllowedViewers)
        .where(
          and(
            eq(taskAllowedViewers.taskId, task.id),
            eq(taskAllowedViewers.viewerAddress, viewerAddress)
          )
        );

      return { success: true };
    }),

  listAllowedViewers: protectedProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/tasks/{taskId}/private-access/viewers',
        tags: ['Tasks'],
        summary: "List a private task's wallet allowlist (requester only)",
      },
    })
    .input(ListAllowedViewersInputSchema)
    .output(ListAllowedViewersResponseSchema)
    .query(async ({ input, ctx }) => {
      const task = await requireOwnedPrivateTask(ctx, input.taskId);

      const rows = await ctx.db
        .select()
        .from(taskAllowedViewers)
        .where(eq(taskAllowedViewers.taskId, task.id));

      return rows.map((row) => ({
        viewerAddress: row.viewerAddress,
        addedBy: row.addedBy,
        createdAt: row.createdAt.toISOString(),
      }));
    }),
});

// The allowlist itself is requester-only-visible (not part of the general task
// response) to avoid leaking who's invited to a third party -- every mutation/read here
// requires ctx.caller to be exactly the task's requester. Throws NOT_FOUND (not
// FORBIDDEN) for a missing task to match tasks.get's existing non-leaking pattern, and
// FORBIDDEN for a real task the caller doesn't own -- unlike tasks.get, ownership here
// is being actively asserted by the caller, not passively checked for a read, so
// confirming "this task exists but isn't yours" carries no extra risk.
async function requireOwnedPrivateTask(
  ctx: { db: typeof import('../db/client').db; caller: { address: string } },
  taskId: string
) {
  const rows = await ctx.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  }
  if (task.requester.toLowerCase() !== ctx.caller.address.toLowerCase()) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the task requester can manage access',
    });
  }
  if (task.taskVisibility !== 'private') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Task is not private' });
  }
  return task;
}
