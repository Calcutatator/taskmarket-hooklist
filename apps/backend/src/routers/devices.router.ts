import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { devices, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { getServerConfig } from '../config/env';
import { createHash, hkdfSync, randomBytes, randomUUID } from 'crypto';
import { contractRegisterIdentity } from '../services/contract';

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function deriveDeviceEncryptionKey(masterKeyHex: string, deviceId: string): string {
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
    .input(z.object({ walletAddress: z.string() }))
    .output(
      z.object({
        deviceId: z.string(),
        apiToken: z.string(),
        deviceEncryptionKey: z.string(),
        agentId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const config = getServerConfig();
      const deviceId = randomUUID();
      const apiToken = randomBytes(32).toString('hex');
      const apiTokenHash = sha256Hex(apiToken);
      const deviceEncryptionKey = deriveDeviceEncryptionKey(config.PLATFORM_MASTER_KEY, deviceId);

      await ctx.db.insert(devices).values({
        id: deviceId,
        apiTokenHash,
        walletAddress: input.walletAddress,
      });

      // Register ERC-8004 identity — platform sponsors this, no USDC required from agent.
      // Idempotent: if the wallet is already registered, return the existing agentId.
      const existing = await ctx.db
        .select({ agentId: agents.agentId })
        .from(agents)
        .where(eq(agents.address, input.walletAddress))
        .limit(1);

      let agentId: string;
      if (existing[0]?.agentId) {
        agentId = existing[0].agentId;
      } else {
        const agentIdBigInt = await contractRegisterIdentity();
        agentId = agentIdBigInt.toString();
        await ctx.db
          .insert(agents)
          .values({ address: input.walletAddress, agentId })
          .onConflictDoUpdate({
            target: agents.address,
            set: { agentId, updatedAt: new Date() },
          });
      }

      return { deviceId, apiToken, deviceEncryptionKey, agentId };
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
