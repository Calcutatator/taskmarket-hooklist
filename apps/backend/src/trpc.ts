import { initTRPC, TRPCError } from '@trpc/server';
import { OpenApiMeta } from 'trpc-to-openapi';
import { type Context } from './context';
import { envelopeForError } from './lib/api-error';
import { runWithRpcOperation } from './lib/rpc-gateway';

const t = initTRPC
  .meta<OpenApiMeta>()
  .context<Context>()
  .create({
    /**
     * Publishes the machine-readable envelope on every error (ADR-0049 point 3, ADR-0058).
     *
     * Here rather than at each router, because "every error carries a discriminator" is only
     * worth anything if it has no exceptions -- a caller that has to test whether the field is
     * present before branching on it is back to reading the message when it is absent. An error
     * nobody classified still gets `{ reason: 'unclassified' }`, so the field is always there
     * and its absence is never a case a client has to model.
     *
     * `shape.data` is where tRPC already puts `code` and `httpStatus`, so an existing client is
     * unaffected: this is strictly additive under a namespaced key.
     */
    errorFormatter({ shape, error }) {
      return {
        ...shape,
        data: { ...shape.data, taskmarket: envelopeForError(error) },
      };
    },
  });

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
