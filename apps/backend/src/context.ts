import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import {
  buildReadAuthMessage,
  IDEMPOTENCY_KEY_HEADER,
  READ_AUTH_ADDRESS_HEADER,
  READ_AUTH_SIGNATURE_HEADER,
  TASK_ACCESS_GRANT_HEADER,
} from '@taskmarket/shared';
import { db } from './db/client';
import { verifySignedAddress } from './lib/agents';
import { verifyTaskAccessGrant, type ResolvedTaskAccessGrant } from './lib/task-access-grants';

export type Caller = { address: string };
export type TaskAccessGrant = ResolvedTaskAccessGrant;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Implements: ADR-0023 (converge inbox/myBids self-auth onto ctx.caller)
/**
 * General read-authentication foundation (ADR-0016, Phase 2's Layer 2): resolves
 * "who is asking" for any read, via a signed message over the caller's own
 * address (buildReadAuthMessage), the same signed-message mechanism agents.inbox
 * and bids.myBids now converge onto (ADR-0023, superseding ADR-0015/0017) -- not
 * the device/API-token header, which
 * only proves possession of a previously-issued token, never address ownership
 * (see ADR-0017's devices.register finding). Never throws: an absent or invalid
 * proof just leaves `caller` undefined, identical to today's fully-anonymous
 * read. Individual procedures (optionalAuthProcedure/protectedProcedure) decide
 * whether a missing caller is acceptable.
 */
export async function resolveCaller(
  req: CreateExpressContextOptions['req']
): Promise<Caller | undefined> {
  const address = headerValue(req.headers[READ_AUTH_ADDRESS_HEADER.toLowerCase()]);
  const signature = headerValue(req.headers[READ_AUTH_SIGNATURE_HEADER.toLowerCase()]);
  if (!address || !signature) return undefined;

  const result = await verifySignedAddress(buildReadAuthMessage(address), signature, address);
  return result.verified ? { address: address.toLowerCase() } : undefined;
}

/**
 * Phase 3 (ADR-0030): resolves a task-scoped password-access grant, additive and
 * sibling to `caller` above -- a wallet identity and an anonymous, task-scoped bearer
 * proof are different kinds of thing, so this is never merged into `Caller`. Never
 * throws, same posture as `resolveCaller`: an absent or invalid grant just leaves
 * `taskAccessGrant` undefined, and `canView` falls through to the wallet-identity checks.
 */
export async function resolveTaskAccessGrant(
  req: CreateExpressContextOptions['req']
): Promise<TaskAccessGrant | undefined> {
  const token = headerValue(req.headers[TASK_ACCESS_GRANT_HEADER.toLowerCase()]);
  if (!token) return undefined;
  return (await verifyTaskAccessGrant(db, token)) ?? undefined;
}

// Implements: ADR-0052
/**
 * The caller's idempotency key for a relayed write, taken verbatim off the header.
 *
 * Resolved here for the same reason `caller` is -- it belongs to the request, not to any one
 * router -- and left `undefined` rather than rejected when absent, because whether a key is
 * required depends on what the procedure does. A read needs none; every relayed write needs
 * one, and `recordRelayedIntent` is the single place that says so.
 *
 * Surrounding whitespace is stripped and a blank header is treated as absent. A key that
 * survives a shell variable or a copied-and-pasted envelope with a trailing newline is the
 * same key the caller sent on their first attempt, and it has to resolve to the same value or
 * the retry claims a second intent for one operation. Length is not checked here: the key is
 * required to be a UUID (`IDEMPOTENCY_KEY_PATTERN` in services/relayed-intents.ts), so
 * anything longer than 36 characters is already refused with `idempotency_key_required`
 * before the payment challenge.
 */
export function resolveIdempotencyKey(req: CreateExpressContextOptions['req']): string | undefined {
  const raw = headerValue(req.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()]);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export async function createContext({ req, res }: CreateExpressContextOptions) {
  return {
    db,
    req,
    res,
    caller: await resolveCaller(req),
    idempotencyKey: resolveIdempotencyKey(req),
    taskAccessGrant: await resolveTaskAccessGrant(req),
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
