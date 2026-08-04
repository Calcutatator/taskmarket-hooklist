import { router, publicProcedure } from '../trpc';
import { RegistrationSource, type ApiErrorEnvelope } from '@taskmarket/shared';
import { z } from 'zod';
import { agents } from '../db/schema';
import { sql } from 'drizzle-orm';
import { contractRegisterIdentityTx } from '../services/contract';
import { apiError } from '../lib/api-error';
import { lowerAddressEq } from '../lib/agents';
import { getServerConfig } from '../config/env';
import { settledPaymentReference } from '../middleware/x402';
import { runRelayedIntent } from '../services/relayed-intent-request';
import type { IdentityRegisterIntentPayload } from '../services/intents/identity-intents';
import { RELAYED_WRITE_REQUEST_HEADERS } from '../lib/openapi-headers';

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
        requestHeaders: RELAYED_WRITE_REQUEST_HEADERS,
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
        // The x402 exchange did not leave a settled payment behind, so nothing was charged and
        // there is no intent to poll -- exactly what `payment_rejected` names. UNAUTHORIZED
        // rather than the reason's default 400, to answer the same status the sibling paid
        // routes already answer their own missing payer with.
        throw apiError({
          code: 'UNAUTHORIZED',
          message: 'Payment required: missing payer',
          reason: 'payment_rejected',
        });
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
      const { intent } = await runRelayedIntent({
        db: ctx.db,
        idempotencyKey: ctx.idempotencyKey,
        operation: 'identity.register',
        payer,
        payment: settledPaymentReference(ctx.res),
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
        // Not a failed chain call: the mint is confirmed and the identity exists, only the
        // read-back of the agentId the completion decodes has not landed yet. That is
        // `intent_completion_deferred` -- nothing to refund, nothing to resubmit, and the
        // reconciler finishes the recording on its own. The intent id is what makes that
        // actionable, so it goes on the envelope for the caller to poll `intents.get` with;
        // without it the caller is told to wait with no handle to wait on.
        throw apiError({
          idempotencyKey: ctx.idempotencyKey,
          intentId: intent.id,
          intentStatus: intent.status as ApiErrorEnvelope['intentStatus'],
          message: 'Identity registered on chain but the agent id was not recorded',
          operation: 'identity.register',
          reason: 'intent_completion_deferred',
        });
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
