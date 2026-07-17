import { router, publicProcedure } from '../trpc';
import { RegistrationSource } from '@taskmarket/shared';
import { z } from 'zod';
import { agents } from '../db/schema';
import { sql } from 'drizzle-orm';
import { contractRegisterIdentity } from '../services/contract';

function lowerAddressEq(address: string) {
  return sql`lower(${agents.address}) = lower(${address})`;
}

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
      const payer: string = ctx.res.locals.payer?.toLowerCase();
      if (!payer) {
        throw new Error('Payment required: missing payer');
      }

      const registeredVia = input.source ?? 'cli';

      // Idempotent: return existing agentId if already registered. Case-insensitive
      // and preferring a row with agent_id set, to tolerate a legacy mixed-case row
      // for this same address from before addresses were consistently lowercased here.
      const existing = await ctx.db
        .select({ address: agents.address, agentId: agents.agentId })
        .from(agents)
        .where(lowerAddressEq(payer))
        .orderBy(sql`${agents.agentId} is not null desc`)
        .limit(1);

      if (existing[0]?.agentId) {
        return { agentId: existing[0].agentId, alreadyRegistered: true };
      }

      // Mint a new ERC-8004 identity via the server wallet
      const agentIdBigInt = await contractRegisterIdentity();
      const agentIdStr = agentIdBigInt.toString();

      if (existing[0]) {
        // A row already exists for this address under a different casing (e.g. a
        // public key published before this endpoint consistently lowercased
        // addresses). agents.address has no case-insensitive uniqueness
        // constraint, so onConflictDoUpdate below would not match it and would
        // create a second row instead -- update the row we already found by its
        // exact stored address rather than inserting a new one.
        await ctx.db
          .update(agents)
          .set({ agentId: agentIdStr, updatedAt: new Date() })
          .where(sql`${agents.address} = ${existing[0].address}`);
      } else {
        await ctx.db
          .insert(agents)
          .values({ address: payer, agentId: agentIdStr, registeredVia })
          .onConflictDoNothing();
      }

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
        .where(lowerAddressEq(input.address))
        .orderBy(sql`${agents.agentId} is not null desc`)
        .limit(1);

      const agentId = result[0]?.agentId ?? null;
      return { agentId, registered: agentId !== null };
    }),
});
