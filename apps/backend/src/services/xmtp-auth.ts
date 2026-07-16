import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { devices } from '../db/schema';
import type { Context } from '../context';
import { sha256Hex } from '../lib/hash';

export interface XmtpAuthInput {
  deviceId: string;
  apiToken: string;
}

export interface AuthenticatedXmtpDevice {
  deviceId: string;
  walletAddress: string;
}

export async function authenticateXmtpDevice(
  ctx: Pick<Context, 'db'>,
  input: XmtpAuthInput
): Promise<AuthenticatedXmtpDevice> {
  const deviceRows = await ctx.db
    .select()
    .from(devices)
    .where(eq(devices.id, input.deviceId))
    .limit(1);

  if (!deviceRows.length) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Device not found' });
  }

  const device = deviceRows[0];
  if (device.apiTokenHash !== sha256Hex(input.apiToken)) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid token' });
  }

  if (device.revokedAt !== null) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Device has been revoked' });
  }

  return {
    deviceId: device.id,
    walletAddress: device.walletAddress,
  };
}
