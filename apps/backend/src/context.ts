import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import {
  buildReadAuthMessage,
  READ_AUTH_ADDRESS_HEADER,
  READ_AUTH_SIGNATURE_HEADER,
} from '@taskmarket/shared';
import { db } from './db/client';
import { verifySignedAddress } from './lib/agents';

export type Caller = { address: string };

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * General read-authentication foundation (ADR-0016, Phase 2's Layer 2): resolves
 * "who is asking" for any read, via a signed message over the caller's own
 * address (buildReadAuthMessage), the same signed-message mechanism agents.inbox
 * and bids.myBids use (ADR-0015/0017) -- not the device/API-token header, which
 * only proves possession of a previously-issued token, never address ownership
 * (see ADR-0017's devices.register finding). Never throws: an absent or invalid
 * proof just leaves `caller` undefined, identical to today's fully-anonymous
 * read. Individual procedures (optionalAuthProcedure/protectedProcedure) decide
 * whether a missing caller is acceptable.
 */
async function resolveCaller(req: CreateExpressContextOptions['req']): Promise<Caller | undefined> {
  const address = headerValue(req.headers[READ_AUTH_ADDRESS_HEADER.toLowerCase()]);
  const signature = headerValue(req.headers[READ_AUTH_SIGNATURE_HEADER.toLowerCase()]);
  if (!address || !signature) return undefined;

  const result = await verifySignedAddress(buildReadAuthMessage(address), signature, address);
  return result.verified ? { address: address.toLowerCase() } : undefined;
}

export async function createContext({ req, res }: CreateExpressContextOptions) {
  return {
    db,
    req,
    res,
    caller: await resolveCaller(req),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
