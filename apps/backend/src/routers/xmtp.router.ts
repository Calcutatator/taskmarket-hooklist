import {
  XmtpBootstrapInputSchema,
  XmtpBootstrapOutputSchema,
  XmtpStatusInputSchema,
  XmtpStatusOutputSchema,
  XmtpHeartbeatInputSchema,
  XmtpHeartbeatOutputSchema,
  XmtpPeerPolicyUpsertSchema,
  XmtpPeerPolicyUpsertOutputSchema,
  XmtpPeerPolicyListSchema,
  XmtpPeerPolicyListOutputSchema,
  XmtpResolvePeerInputSchema,
  XmtpResolvePeerOutputSchema,
} from '@taskmarket/shared';
import { TRPCError } from '@trpc/server';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { getServerConfig } from '../config/env';
import { agents, agentXmtpInstallations, agentXmtpPeerPolicies } from '../db/schema';
import {
  listAgentInstallations,
  heartbeatInstallation,
  findStaleInstallations,
} from '../services/xmtp-status';
import { authenticateXmtpDevice } from '../services/xmtp-auth';
import { lowerAddressEq, lowerColumnEq } from '../lib/agents';
import { normalizeAddress } from '@taskmarket/shared';
import { getPolicyMode } from '../services/xmtp-policy';
import { publicProcedure, router } from '../trpc';

function requireXmtpEnabled(): void {
  if (!getServerConfig().XMTP_ENABLED) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'XMTP is disabled' });
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Resolves the API token from the body (preferred) or from request headers.
 * Used by query procedures (status, listPeerPolicies) where apiToken is
 * optional in the schema to support both body-based and header-based auth.
 * Mutation procedures (bootstrap, heartbeat, setPeerPolicy) require apiToken
 * in the body directly and do not call this helper.
 */
function resolveApiToken(
  inputApiToken: string | undefined,
  headers: Record<string, string | string[] | undefined>
): string {
  if (inputApiToken) {
    return inputApiToken;
  }

  const explicitHeader = headerValue(headers['x-taskmarket-api-token']);
  if (explicitHeader) {
    return explicitHeader;
  }

  const authHeader = headerValue(headers.authorization);
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) {
      return token;
    }
  }

  throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing XMTP api token' });
}

export const xmtpRouter = router({
  bootstrap: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/xmtp/bootstrap',
        tags: ['XMTP'],
        summary: 'Bootstrap XMTP identity and installation metadata for a device',
      },
    })
    .input(XmtpBootstrapInputSchema)
    .output(XmtpBootstrapOutputSchema)
    .mutation(async ({ input, ctx }) => {
      requireXmtpEnabled();
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });

      await ctx.db
        .insert(agents)
        .values({
          address: normalizeAddress(auth.walletAddress),
        })
        .onConflictDoNothing();

      const updatedAgents = await ctx.db
        .update(agents)
        .set({
          xmtpInboxId: input.inboxId,
          xmtpEnabled: 1,
          xmtpLastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            lowerAddressEq(auth.walletAddress),
            or(isNull(agents.xmtpInboxId), eq(agents.xmtpInboxId, input.inboxId))
          )
        )
        .returning({ address: agents.address });

      if (updatedAgents.length === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'XMTP inbox mismatch for wallet' });
      }

      const existingInstallationRows = await ctx.db
        .select({
          agentAddress: agentXmtpInstallations.agentAddress,
          deviceId: agentXmtpInstallations.deviceId,
          inboxId: agentXmtpInstallations.inboxId,
        })
        .from(agentXmtpInstallations)
        .where(eq(agentXmtpInstallations.installationId, input.installationId))
        .limit(1);

      const existingInstallation = existingInstallationRows[0];
      if (existingInstallation) {
        const isOwnerMatch =
          existingInstallation.agentAddress.toLowerCase() === auth.walletAddress.toLowerCase() &&
          existingInstallation.deviceId === input.deviceId &&
          existingInstallation.inboxId === input.inboxId;

        if (!isOwnerMatch) {
          throw new Error('XMTP installation mismatch for wallet/device');
        }

        await ctx.db
          .update(agentXmtpInstallations)
          .set({
            status: 'active',
            revokedAt: null,
            lastSeenAt: new Date(),
            dbPath: input.dbPath,
            clientVersion: input.clientVersion,
          })
          .where(eq(agentXmtpInstallations.installationId, input.installationId));
      } else {
        await ctx.db.insert(agentXmtpInstallations).values({
          agentAddress: auth.walletAddress,
          deviceId: input.deviceId,
          inboxId: input.inboxId,
          installationId: input.installationId,
          dbPath: input.dbPath,
          clientVersion: input.clientVersion,
          status: 'active',
          lastSeenAt: new Date(),
        });
      }

      return {
        inboxId: input.inboxId,
        installationId: input.installationId,
        policyMode: getPolicyMode(),
      };
    }),

  status: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/xmtp/status',
        tags: ['XMTP'],
        summary: 'Get XMTP status for a device wallet',
      },
    })
    .input(XmtpStatusInputSchema)
    .output(XmtpStatusOutputSchema)
    .query(async ({ input, ctx }) => {
      requireXmtpEnabled();
      const apiToken = resolveApiToken(input.apiToken, ctx.req.headers);
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken,
      });

      const agentRows = await ctx.db
        .select({
          xmtpInboxId: agents.xmtpInboxId,
          xmtpEnabled: agents.xmtpEnabled,
          xmtpLastSeenAt: agents.xmtpLastSeenAt,
        })
        .from(agents)
        .where(lowerAddressEq(auth.walletAddress))
        .limit(1);

      const installations = await listAgentInstallations(ctx.db, auth.walletAddress);

      return {
        inboxId: agentRows[0]?.xmtpInboxId ?? null,
        enabled: (agentRows[0]?.xmtpEnabled ?? 0) === 1,
        policyMode: getPolicyMode(),
        lastSeenAt: agentRows[0]?.xmtpLastSeenAt?.toISOString() ?? null,
        activeInstallations: installations.map((row) => ({
          installationId: row.installationId,
          status: row.status,
          lastSeenAt: row.lastSeenAt.toISOString(),
        })),
      };
    }),

  heartbeat: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/xmtp/heartbeat',
        tags: ['XMTP'],
        summary: 'Refresh XMTP installation heartbeat',
      },
    })
    .input(XmtpHeartbeatInputSchema)
    .output(XmtpHeartbeatOutputSchema)
    .mutation(async ({ input, ctx }) => {
      requireXmtpEnabled();
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });
      const didUpdate = await heartbeatInstallation(ctx.db, {
        installationId: input.installationId,
        deviceId: input.deviceId,
        agentAddress: auth.walletAddress,
      });
      if (!didUpdate) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Installation not found for authenticated device',
        });
      }

      await ctx.db
        .update(agents)
        .set({ xmtpLastSeenAt: new Date(), updatedAt: new Date() })
        .where(lowerAddressEq(auth.walletAddress));

      return { ok: true };
    }),

  setPeerPolicy: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/xmtp/peers',
        tags: ['XMTP'],
        summary: 'Set peer policy for an owner agent',
      },
    })
    .input(XmtpPeerPolicyUpsertSchema)
    .output(XmtpPeerPolicyUpsertOutputSchema)
    .mutation(async ({ input, ctx }) => {
      requireXmtpEnabled();
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken: input.apiToken,
      });

      await ctx.db
        .insert(agentXmtpPeerPolicies)
        .values({
          ownerAgentAddress: auth.walletAddress,
          peerInboxId: input.peerInboxId,
          policy: input.policy,
          reason: input.reason,
          updatedByDeviceId: input.deviceId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [agentXmtpPeerPolicies.ownerAgentAddress, agentXmtpPeerPolicies.peerInboxId],
          set: {
            policy: input.policy,
            reason: input.reason,
            updatedByDeviceId: input.deviceId,
            updatedAt: new Date(),
          },
        });

      return { ok: true };
    }),

  listPeerPolicies: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/xmtp/peers',
        tags: ['XMTP'],
        summary: 'List peer policies for the caller agent',
      },
    })
    .input(XmtpPeerPolicyListSchema)
    .output(XmtpPeerPolicyListOutputSchema)
    .query(async ({ input, ctx }) => {
      requireXmtpEnabled();
      const apiToken = resolveApiToken(input.apiToken, ctx.req.headers);
      const auth = await authenticateXmtpDevice(ctx, {
        deviceId: input.deviceId,
        apiToken,
      });

      const rows = await ctx.db
        .select({
          peerInboxId: agentXmtpPeerPolicies.peerInboxId,
          policy: agentXmtpPeerPolicies.policy,
          reason: agentXmtpPeerPolicies.reason,
          updatedAt: agentXmtpPeerPolicies.updatedAt,
        })
        .from(agentXmtpPeerPolicies)
        .where(lowerColumnEq(agentXmtpPeerPolicies.ownerAgentAddress, auth.walletAddress));

      return {
        policies: rows.map((row) => ({
          peerInboxId: row.peerInboxId,
          policy: row.policy as 'allow' | 'deny' | 'quarantine',
          reason: row.reason,
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    }),

  resolvePeer: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/xmtp/resolve',
        tags: ['XMTP'],
        summary: 'Resolve a peer inbox by address or agentId',
      },
    })
    .input(XmtpResolvePeerInputSchema)
    .output(XmtpResolvePeerOutputSchema)
    .query(async ({ input, ctx }) => {
      requireXmtpEnabled();

      const whereClause = input.address
        ? and(lowerAddressEq(input.address!), eq(agents.xmtpEnabled, 1))
        : and(eq(agents.agentId, input.agentId!), eq(agents.xmtpEnabled, 1));

      const rows = await ctx.db
        .select({ address: agents.address, xmtpInboxId: agents.xmtpInboxId })
        .from(agents)
        .where(whereClause)
        .limit(1);

      return {
        address: rows[0]?.address ?? null,
        inboxId: rows[0]?.xmtpInboxId ?? null,
      };
    }),

  purgeStale: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/xmtp/purge',
        tags: ['XMTP'],
        summary: 'Revoke stale XMTP installations that have missed heartbeats',
      },
    })
    .input(XmtpHeartbeatInputSchema.pick({ deviceId: true, apiToken: true }))
    .output(z.object({ purged: z.number() }))
    .mutation(async ({ input, ctx }) => {
      requireXmtpEnabled();
      const auth = await authenticateXmtpDevice(ctx, input);
      const config = getServerConfig();
      const staleBefore = new Date(Date.now() - config.XMTP_STALE_INSTALLATION_MINUTES * 60_000);
      const stale = await findStaleInstallations(ctx.db, staleBefore, auth.walletAddress);
      if (stale.length > 0) {
        await ctx.db
          .update(agentXmtpInstallations)
          .set({ status: 'revoked', revokedAt: new Date() })
          .where(
            inArray(
              agentXmtpInstallations.id,
              stale.map((r) => r.id)
            )
          );
      }
      return { purged: stale.length };
    }),
});
