import { router, publicProcedure } from '../trpc';
import { RegistrationSource } from '@taskmarket/shared';
import { z } from 'zod';
import { agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { contractRegisterIdentity } from '../services/contract';

export const identityRouter = router({
  register: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/identity/register',
        tags: ['Identity'],
        summary: 'Register ERC-8004 agent identity (X402 required, 0.001 USDC)',
      },
    })
    .input(z.object({ source: RegistrationSource.optional() }))
    .output(z.object({ agentId: z.string(), alreadyRegistered: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const payer: string = ctx.res.locals.payer;
      if (!payer) {
        throw new Error('Payment required: missing payer');
      }

      const registeredVia = input.source ?? 'cli';

      // Idempotent: return existing agentId if already registered
      const existing = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(eq(agents.address, payer))
        .limit(1);

      if (existing[0]?.agentId) {
        return { agentId: existing[0].agentId, alreadyRegistered: true };
      }

      // Mint a new ERC-8004 identity via the server wallet
      const agentIdBigInt = await contractRegisterIdentity();
      const agentIdStr = agentIdBigInt.toString();

      // Upsert: associate the new agentId with the paying wallet in our DB.
      // registeredVia is immutable after first insert: onConflict only updates
      // agentId, never the channel that registered the original row.
      await ctx.db
        .insert(agents)
        .values({ address: payer, agentId: agentIdStr, registeredVia })
        .onConflictDoUpdate({
          target: agents.address,
          set: { agentId: agentIdStr, updatedAt: new Date() },
        });

      return { agentId: agentIdStr, alreadyRegistered: false };
    }),

  status: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/identity/status',
        tags: ['Identity'],
        summary: 'Check ERC-8004 identity registration status for a wallet',
      },
    })
    .input(z.object({ address: z.string() }))
    .output(z.object({ agentId: z.string().nullable(), registered: z.boolean() }))
    .query(async ({ input, ctx }) => {
      const result = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(eq(agents.address, input.address))
        .limit(1);

      const agentId = result[0]?.agentId ?? null;
      return { agentId, registered: agentId !== null };
    }),
});
