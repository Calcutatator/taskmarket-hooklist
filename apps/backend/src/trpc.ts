import { initTRPC, TRPCError } from '@trpc/server';
import { OpenApiMeta } from 'trpc-to-openapi';
import { type Context } from './context';

const t = initTRPC.meta<OpenApiMeta>().context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Same as publicProcedure -- ctx.caller is already resolved for every request
 * (see context.ts). This alias exists purely to mark, at the call site, which
 * procedures actually branch their response on ctx.caller (Phase 2's
 * requester-sees-all/worker-sees-own role gating) versus ones that ignore it.
 */
export const optionalAuthProcedure = t.procedure;

/** Throws UNAUTHORIZED unless the caller proved address ownership (see context.ts). */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.caller) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Caller authentication required' });
  }
  return next({ ctx: { ...ctx, caller: ctx.caller } });
});
