import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { devices } from '../db/schema';
import type { Context } from '../context';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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
    throw new Error('Device not found');
  }

  const device = deviceRows[0];
  if (device.apiTokenHash !== sha256Hex(input.apiToken)) {
    throw new Error('Invalid token');
  }

  if (device.revokedAt !== null) {
    throw new Error('Device has been revoked');
  }

  return {
    deviceId: device.id,
    walletAddress: device.walletAddress,
  };
}
