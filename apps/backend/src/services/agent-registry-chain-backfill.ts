import { and, isNull, isNotNull, or } from 'drizzle-orm';
import { getServerConfig } from '../config/env';
import { db } from '../db/client';
import { agents } from '../db/schema';

export type AgentRegistryChainBackfillOptions = {
  dryRun?: boolean;
};

export type AgentRegistryChainBackfillSummary = {
  dryRun: boolean;
  registryAddress: string;
  chainId: number;
  affectedAddresses: string[];
  updatedRows: number;
};

// identity.router.ts's register() only trusts a cached agentId when both
// identity_registry_address and chain_id (see migrations 0032/0033) match the
// currently configured values. Both columns are NULL for every row that
// existed before those migrations ran, so without this backfill, every
// already-registered agent's next /identity/register call would look "stale"
// and mint a brand-new on-chain agentId -- orphaning their original one and
// any reputation/feedback history tied to it. This assumes the registry
// contract and chain configured right now are the ones every existing
// agent_id was actually minted against, which holds for every environment
// that has not itself changed registry/chain since it first went live -- run
// this immediately after migrating, before any real /identity/register
// traffic, so that assumption stays true.
export async function runAgentRegistryChainBackfill(
  options: AgentRegistryChainBackfillOptions = {}
): Promise<AgentRegistryChainBackfillSummary> {
  const config = getServerConfig();
  const registryAddress = config.ERC8004_IDENTITY_REGISTRY.toLowerCase();
  const chainId = config.CHAIN_ID;
  const whereClause = and(
    isNotNull(agents.agentId),
    or(isNull(agents.identityRegistryAddress), isNull(agents.chainId))
  );

  if (options.dryRun) {
    const wouldUpdate = await db
      .select({ address: agents.address })
      .from(agents)
      .where(whereClause);
    return {
      dryRun: true,
      registryAddress,
      chainId,
      affectedAddresses: wouldUpdate.map((row) => row.address),
      updatedRows: wouldUpdate.length,
    };
  }

  const updated = await db
    .update(agents)
    .set({ identityRegistryAddress: registryAddress, chainId })
    .where(whereClause)
    .returning({ address: agents.address });

  return {
    dryRun: false,
    registryAddress,
    chainId,
    affectedAddresses: updated.map((row) => row.address),
    updatedRows: updated.length,
  };
}
