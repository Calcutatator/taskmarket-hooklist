// Implements: ADR-0045
import { sql } from 'drizzle-orm';

import type { db as DbType } from '../../db/client';
import { agents } from '../../db/schema';
import { resolveRegisteredAgentId } from '../contract';

type Db = typeof DbType;

export type IdentityRegisterIntentPayload = {
  chainId: number;
  existingAddress: string | null;
  payer: string;
  registeredVia: string;
  registryAddress: string;
};

/**
 * Bind the agentId a confirmed registry mint produced to the paying wallet.
 *
 * The agentId is decoded from the transaction's own Registered event rather than carried in
 * the payload: the payload is written before the mint exists, and the completion may run from
 * the reconciler with only the hash (ADR-0045). ADR-0022 makes this binding permanent, so the
 * write is by definition the same on every attempt.
 */
export async function completeIdentityRegister(context: {
  db: Db;
  payload: IdentityRegisterIntentPayload;
  txHash: `0x${string}`;
}): Promise<void> {
  const { db, payload } = context;
  const agentId = (await resolveRegisteredAgentId(context.txHash)).toString();

  if (payload.existingAddress) {
    // A row already exists for this address under a different casing. agents.address has no
    // case-insensitive uniqueness constraint, so an upsert would not match it and would
    // create a second row -- update the row that was found, by its exact stored address.
    await db
      .update(agents)
      .set({
        agentId,
        chainId: payload.chainId,
        identityRegistryAddress: payload.registryAddress,
        updatedAt: new Date(),
      })
      .where(sql`${agents.address} = ${payload.existingAddress}`);
    return;
  }

  await db
    .insert(agents)
    .values({
      address: payload.payer,
      agentId,
      chainId: payload.chainId,
      identityRegistryAddress: payload.registryAddress,
      registeredVia: payload.registeredVia,
    })
    .onConflictDoNothing();
}
