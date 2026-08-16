import { TRPCError } from '@trpc/server';

import { getServerConfig } from '../config/env';
import { verifyPrivyAccessToken } from './privy-auth';

// Implements: ADR-0088. This is intentionally separate from wallet read-auth and from legal
// receipts: curator authority is an exact, server-configured Privy user ID after a server-side
// bearer-token verification. An empty allowlist always denies access.
export async function requireSlapChopCurator(authorization: string | undefined): Promise<string> {
  let userId: string;
  try {
    const claim = await verifyPrivyAccessToken(authorization);
    userId = claim.user_id;
  } catch {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'A valid Privy access token is required for curator access',
    });
  }

  const allowlist = getServerConfig().SLAP_CHOP_CURATOR_PRIVY_USER_IDS;
  if (!allowlist.includes(userId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Curator access is not authorized',
    });
  }

  return userId;
}
