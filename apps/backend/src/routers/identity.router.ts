import { router, publicProcedure } from '../trpc';
import { RegistrationSource } from '@taskmarket/shared';
import { z } from 'zod';
import { agents } from '../db/schema';
import { sql } from 'drizzle-orm';
import { contractRegisterIdentity } from '../services/contract';
import { lowerAddressEq } from '../lib/agents';
import { getServerConfig } from '../config/env';

// Only trust a cached agentId if it was minted against the currently configured
// registry contract AND chain -- see register()'s cacheIsFresh usage for why
// registry address alone isn't enough (ERC-8004 identity registries are commonly
// deployed at the SAME address on every chain).
function isCacheFresh(
  row: { identityRegistryAddress: string | null; chainId: number | null } | undefined,
  registryAddress: string,
  chainId: number
): boolean {
  return (
    row?.identityRegistryAddress?.toLowerCase() === registryAddress && row?.chainId === chainId
  );
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
      const config = getServerConfig();
      const registryAddress = config.ERC8004_IDENTITY_REGISTRY.toLowerCase();
      const chainId = config.CHAIN_ID;

      // Idempotent: return existing agentId if already registered. Case-insensitive
      // and preferring a row with agent_id set, to tolerate a legacy mixed-case row
      // for this same address from before addresses were consistently lowercased here.
      const existing = await ctx.db
        .select({
          address: agents.address,
          agentId: agents.agentId,
          identityRegistryAddress: agents.identityRegistryAddress,
          chainId: agents.chainId,
        })
        .from(agents)
        .where(lowerAddressEq(payer))
        .orderBy(sql`${agents.agentId} is not null desc`)
        .limit(1);

      // Only trust the cached agentId if it was minted against the currently
      // configured registry contract AND chain -- see isCacheFresh() above.
      const cacheIsFresh = isCacheFresh(existing[0], registryAddress, chainId);

      if (existing[0]?.agentId && cacheIsFresh) {
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
          .set({
            agentId: agentIdStr,
            identityRegistryAddress: registryAddress,
            chainId,
            updatedAt: new Date(),
          })
          .where(sql`${agents.address} = ${existing[0].address}`);
      } else {
        await ctx.db
          .insert(agents)
          .values({
            address: payer,
            agentId: agentIdStr,
            identityRegistryAddress: registryAddress,
            chainId,
            registeredVia,
          })
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
    .output(
      z.object({
        agentId: z.string().nullable(),
        registered: z.boolean(),
        // False when agentId is set but register() would still mint a new one on
        // this wallet's next call (registry/chain mismatch).
        cacheFresh: z.boolean(),
      })
    )
    .query(async ({ input, ctx }) => {
      const config = getServerConfig();
      const registryAddress = config.ERC8004_IDENTITY_REGISTRY.toLowerCase();
      const chainId = config.CHAIN_ID;

      const result = await ctx.db
        .select({
          agentId: agents.agentId,
          identityRegistryAddress: agents.identityRegistryAddress,
          chainId: agents.chainId,
        })
        .from(agents)
        .where(lowerAddressEq(input.address))
        .orderBy(sql`${agents.agentId} is not null desc`)
        .limit(1);

      const agentId = result[0]?.agentId ?? null;
      const cacheFresh = agentId !== null && isCacheFresh(result[0], registryAddress, chainId);
      return { agentId, registered: agentId !== null, cacheFresh };
    }),
});
