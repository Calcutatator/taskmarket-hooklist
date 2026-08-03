import { router, publicProcedure } from '../trpc';
import { RegistrationSource } from '@taskmarket/shared';
import { z } from 'zod';
import { agents } from '../db/schema';
import { sql } from 'drizzle-orm';
import { contractRegisterIdentityTx } from '../services/contract';
import { lowerAddressEq } from '../lib/agents';
import { getServerConfig } from '../config/env';
import { runRelayedIntent } from '../services/relayed-intent-request';
import type { IdentityRegisterIntentPayload } from '../services/intents/identity-intents';

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

// Implements: ADR-0022 (agentId permanently bound to registering wallet)
// register() is the sole write path that ever associates an agentId with an
// address (agents.agent_id, enforced unique by migration 0034_agents_agent_id_unique.sql);
// there is no reassignment/migrate/transfer endpoint anywhere in this router,
// the CLI, or the web app.
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

      // Mint a new ERC-8004 identity via the server wallet. The agentId the caller gets back
      // is decoded from the mint's own Registered event by the completion handler and read
      // back from the row here, rather than returned by the chain call: the completion is
      // the one copy of that work that also runs when a reconciler finishes the intent.
      await runRelayedIntent({
        db: ctx.db,
        operation: 'identity.register',
        payer,
        paymentTxHash: ctx.res.locals.paymentTxHash as `0x${string}` | undefined,
        payload: {
          chainId,
          existingAddress: existing[0]?.address ?? null,
          payer,
          registeredVia,
          registryAddress,
        } satisfies IdentityRegisterIntentPayload,
        send: () => contractRegisterIdentityTx(),
      });

      const registered = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(lowerAddressEq(payer))
        .orderBy(sql`${agents.agentId} is not null desc`)
        .limit(1);

      const agentIdStr = registered[0]?.agentId;
      if (!agentIdStr) {
        throw new Error('Identity registered on chain but the agent id was not recorded');
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
