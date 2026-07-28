import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { devices, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getServerConfig, DEFAULT_PLATFORM_MASTER_KEY } from '../config/env';
import { hkdfSync, randomBytes, randomUUID } from 'crypto';
import { contractRegisterIdentity } from '../services/contract';
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

      // Register ERC-8004 identity in the background — platform sponsors this.
      // The client should poll GET /api/identity/status?address=... until agentId appears.
      contractRegisterIdentity()
        .then(async (agentIdBigInt) => {
          const id = agentIdBigInt.toString();
          const registryAddress = config.ERC8004_IDENTITY_REGISTRY.toLowerCase();
          await ctx.db
            .insert(agents)
            .values({
              address: walletAddress,
              agentId: id,
              identityRegistryAddress: registryAddress,
              chainId: config.CHAIN_ID,
            })
            .onConflictDoUpdate({
              target: agents.address,
              set: {
                agentId: id,
                identityRegistryAddress: registryAddress,
                chainId: config.CHAIN_ID,
                updatedAt: new Date(),
              },
            });
        })
        .catch((err) => {
          console.error('[devices] background identity registration failed:', err);
        });

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
