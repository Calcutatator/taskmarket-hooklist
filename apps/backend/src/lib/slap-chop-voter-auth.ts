import { TRPCError } from '@trpc/server';

import { verifyPrivyAccessToken } from './privy-auth';

// Implements: ADR-0089. Voting has a stable server-verified Privy identity, but does not inherit
// the curator allowlist or any wallet/payment requirement.
export async function requireSlapChopVoter(authorization: string | undefined): Promise<string> {
  try {
    const claim = await verifyPrivyAccessToken(authorization);
    if (typeof claim.user_id !== 'string' || claim.user_id.trim().length === 0) {
      throw new Error('Privy access token did not contain a user ID');
    }
    return claim.user_id;
  } catch {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'A valid Privy access token is required to vote',
    });
  }
}
