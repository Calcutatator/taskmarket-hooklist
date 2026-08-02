import { initTRPC, TRPCError } from '@trpc/server';
import { OpenApiMeta } from 'trpc-to-openapi';
import { type Context } from './context';
import { runWithRpcOperation } from './lib/rpc-gateway';

const t = initTRPC.meta<OpenApiMeta>().context<Context>().create();

export const router = t.router;
const rpcObservedProcedure = t.procedure.use(({ path, next }) =>
  runWithRpcOperation({ kind: 'procedure', name: path }, () => next())
);
export const publicProcedure = rpcObservedProcedure;

/**
 * Same as publicProcedure -- ctx.caller is already resolved for every request
 * (see context.ts). This alias exists purely to mark, at the call site, which
 * procedures actually branch their response on ctx.caller (Phase 2's
 * requester-sees-all/worker-sees-own role gating) versus ones that ignore it.
 */
export const optionalAuthProcedure = rpcObservedProcedure;

/** Throws UNAUTHORIZED unless the caller proved address ownership (see context.ts). */
export const protectedProcedure = rpcObservedProcedure.use(({ ctx, next }) => {
  if (!ctx.caller) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Caller authentication required' });
  }
  return next({ ctx: { ...ctx, caller: ctx.caller } });
});
