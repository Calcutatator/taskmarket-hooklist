// Implements: ADR-0018 (devices.register requires signature proof of address ownership), ADR-0045
import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { devices, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getServerConfig, DEFAULT_PLATFORM_MASTER_KEY } from '../config/env';
import { hkdfSync, randomBytes, randomUUID } from 'crypto';
import { registerRelayedIntentHandlers } from '../services/intents/register';
import type { IdentityRegisterIntentPayload } from '../services/intents/identity-intents';
import { dispatchRelayedIntent } from '../services/relayed-intent-registry';
import { recordRelayedIntent } from '../services/relayed-intents';
import { lowerAddressEq, verifySignedAddressOrThrow } from '../lib/agents';
import {
  Secp256k1PublicKeySchema,
  buildDeviceRegisterMessage,
  normalizeAddress,
} from '@taskmarket/shared';
import { sha256Hex } from '../lib/hash';

function deriveDeviceEncryptionKey(masterKeyHex: string, deviceId: string): string {
  // getServerConfig()'s startup validation only rejects the default zero key when
  // NODE_ENV === 'production', so a self-hosted/staging deployment that never sets
  // PLATFORM_MASTER_KEY would otherwise silently derive every device's key from a
  // fixed, publicly-known value with no failure at all. Guarding here, at the actual
  // point of derivation, closes that regardless of NODE_ENV.
  if (masterKeyHex === DEFAULT_PLATFORM_MASTER_KEY) {
    throw new Error(
      'PLATFORM_MASTER_KEY is still the default zero key -- set a real secret before deriving device encryption keys'
    );
  }
  const ikm = Buffer.from(masterKeyHex, 'hex');
  const salt = Buffer.alloc(0);
  const info = Buffer.from(deviceId, 'utf8');
  const derived = hkdfSync('sha256', ikm, salt, info, 32);
  return Buffer.from(derived).toString('hex');
}

export const devicesRouter = router({
  register: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/devices',
        tags: ['Devices'],
        summary: 'Register a device, create agent wallet, and register ERC-8004 identity (free)',
      },
    })
    .input(
      z.object({
        walletAddress: z.string(),
        publicKey: Secp256k1PublicKeySchema.optional(),
        signature: z.string(),
      })
    )
    .output(
      z.object({
        deviceId: z.string(),
        apiToken: z.string(),
        deviceEncryptionKey: z.string(),
        agentId: z.string().nullable(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const message = buildDeviceRegisterMessage(input.walletAddress);
      await verifySignedAddressOrThrow(message, input.signature, input.walletAddress, {
        invalid_signature: () =>
          new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' }),
        address_mismatch: () =>
          new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Signature does not match wallet address',
          }),
      });

      const config = getServerConfig();
      const deviceId = randomUUID();
      const apiToken = randomBytes(32).toString('hex');
      const apiTokenHash = sha256Hex(apiToken);
      const deviceEncryptionKey = deriveDeviceEncryptionKey(config.PLATFORM_MASTER_KEY, deviceId);
      const walletAddress = normalizeAddress(input.walletAddress);

      await ctx.db.insert(devices).values({
        id: deviceId,
        apiTokenHash,
        walletAddress,
      });

      // Check if agent already has an on-chain identity registered.
      const existing = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(lowerAddressEq(input.walletAddress))
        .limit(1);

      const agentId: string | null = existing[0]?.agentId ?? null;

      if (agentId) {
        // Already registered — update publicKey if provided, then return.
        if (input.publicKey) {
          await ctx.db
            .update(agents)
            .set({ publicKey: input.publicKey, updatedAt: new Date() })
            .where(lowerAddressEq(input.walletAddress));
        }
        return { deviceId, apiToken, deviceEncryptionKey, agentId };
      }

      // Ensure agent row exists so the background job can update it.
      await ctx.db
        .insert(agents)
        .values({
          address: walletAddress,
          agentId: null,
          ...(input.publicKey ? { publicKey: input.publicKey } : {}),
        })
        .onConflictDoUpdate({
          target: agents.address,
          set: {
            updatedAt: new Date(),
            ...(input.publicKey ? { publicKey: input.publicKey } : {}),
          },
        });

      // Register the ERC-8004 identity in the background -- the platform sponsors this, and
      // the client polls GET /api/identity/status?address=... until agentId appears.
      //
      // ADR-0019 recorded the defect this replaces: the mint was a bare fire-and-forget
      // promise whose only failure handling was a console log, so a failed registration left
      // agents.agentId permanently null with no error, no retry and nothing anywhere that
      // said so. The intent is what fixes it, and it is deliberately split from the dispatch:
      //
      //   - Recording is awaited, so the durable row exists before this request answers. That
      //     is the whole guarantee -- from here on the work survives a crash, a deploy, or
      //     this request being abandoned, because the intent worker will pick up anything
      //     left in `recorded`.
      //   - Dispatching is not awaited. The request must not block on a chain round trip: the
      //     endpoint's contract is that it returns `agentId: null` and the caller polls, and
      //     making it wait would be a client-visible change for no benefit.
      //
      // The completion handler binds the minted agentId to this wallet later, from the
      // transaction's own Registered event, whether it runs from the dispatch below or from a
      // worker pass an hour after this process died.
      registerRelayedIntentHandlers();
      const registerIntent = await recordRelayedIntent({
        db: ctx.db,
        operation: 'identity.register',
        payer: walletAddress,
        payload: {
          chainId: config.CHAIN_ID,
          // The agents row was just upserted under this exact (normalized) address, so the
          // completion must update that row rather than insert a second one.
          existingAddress: walletAddress,
          payer: walletAddress,
          registeredVia: 'device',
          registryAddress: config.ERC8004_IDENTITY_REGISTRY.toLowerCase(),
        } satisfies IdentityRegisterIntentPayload,
      });

      // Never throws, and never awaited: every outcome is already durable on the intent row.
      void dispatchRelayedIntent({ db: ctx.db, intent: registerIntent });

      return { deviceId, apiToken, deviceEncryptionKey, agentId: null };
    }),

  key: publicProcedure
    .meta({
      openapi: {
        method: 'POST',
        path: '/devices/{deviceId}/key',
        tags: ['Devices'],
        summary: 'Fetch device encryption key using API token',
      },
    })
    .input(z.object({ deviceId: z.string(), apiToken: z.string() }))
    .output(z.object({ deviceEncryptionKey: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const config = getServerConfig();

      const result = await ctx.db
        .select()
        .from(devices)
        .where(eq(devices.id, input.deviceId))
        .limit(1);

      if (!result.length) {
        throw new Error('Device not found');
      }

      const device = result[0];
      const apiTokenHash = sha256Hex(input.apiToken);
      if (device.apiTokenHash !== apiTokenHash) {
        throw new Error('Invalid token');
      }

      if (device.revokedAt !== null) {
        throw new Error('Device has been revoked');
      }

      const deviceEncryptionKey = deriveDeviceEncryptionKey(
        config.PLATFORM_MASTER_KEY,
        input.deviceId
      );
      return { deviceEncryptionKey };
    }),

  status: publicProcedure
    .meta({
      openapi: {
        method: 'GET',
        path: '/devices/{deviceId}/status',
        tags: ['Devices'],
        summary: 'Get device status',
      },
    })
    .input(z.object({ deviceId: z.string(), apiToken: z.string() }))
    .output(z.object({ walletAddress: z.string(), active: z.boolean() }))
    .query(async ({ input, ctx }) => {
      const result = await ctx.db
        .select()
        .from(devices)
        .where(eq(devices.id, input.deviceId))
        .limit(1);

      if (!result.length) {
        throw new Error('Device not found');
      }

      const device = result[0];
      const apiTokenHash = sha256Hex(input.apiToken);
      if (device.apiTokenHash !== apiTokenHash) {
        throw new Error('Invalid token');
      }

      return { walletAddress: device.walletAddress, active: device.revokedAt === null };
    }),
});
