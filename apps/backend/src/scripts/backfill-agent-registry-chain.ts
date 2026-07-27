import { and, isNull, isNotNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import { agents } from '../db/schema';

// identity.router.ts's register() only trusts a cached agentId when both
// identity_registry_address and chain_id (see migrations 0032/0033) match the
// currently configured values. Both columns are NULL for every row that
// existed before those migrations ran, so without this backfill, every
// already-registered agent's next /identity/register call would look "stale"
// and mint a brand-new on-chain agentId -- orphaning their original one and
// any reputation/feedback history tied to it. This assumes the registry and
// chain passed in here are the ones every existing agent_id was actually
// minted against -- pass the environment's actual currently-configured
// ERC8004_IDENTITY_REGISTRY/CHAIN_ID values explicitly, run this immediately
// after migrating, before any real /identity/register traffic.
async function runAgentRegistryChainBackfill(
  dryRun: boolean,
  registryAddress: string,
  chainId: number
) {
  const normalizedRegistryAddress = registryAddress.toLowerCase();
  const whereClause = and(
    isNotNull(agents.agentId),
    or(isNull(agents.identityRegistryAddress), isNull(agents.chainId))
  );

  if (dryRun) {
    const wouldUpdate = await db
      .select({ address: agents.address })
      .from(agents)
      .where(whereClause);
    return {
      dryRun: true,
      registryAddress: normalizedRegistryAddress,
      chainId,
      affectedAddresses: wouldUpdate.map((row) => row.address),
      updatedRows: wouldUpdate.length,
    };
  }

  const updated = await db
    .update(agents)
    .set({ identityRegistryAddress: normalizedRegistryAddress, chainId })
    .where(whereClause)
    .returning({ address: agents.address });

  return {
    dryRun: false,
    registryAddress: normalizedRegistryAddress,
    chainId,
    affectedAddresses: updated.map((row) => row.address),
    updatedRows: updated.length,
  };
}

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const dryRun = process.argv.includes('--dry-run');
const registryAddress = readArg('--registry');
const chainIdRaw = readArg('--chain-id');

if (!registryAddress || !/^0x[a-fA-F0-9]{40}$/.test(registryAddress)) {
  console.error(
    'Usage: backfill-agent-registry-chain --registry 0x... --chain-id <number> [--dry-run]'
  );
  console.error('  --registry must be a 0x-prefixed 20-byte address');
  process.exit(1);
}

const chainId = Number(chainIdRaw);
if (!chainIdRaw || !Number.isInteger(chainId) || chainId <= 0) {
  console.error(
    'Usage: backfill-agent-registry-chain --registry 0x... --chain-id <number> [--dry-run]'
  );
  console.error('  --chain-id must be a positive integer');
  process.exit(1);
}

runAgentRegistryChainBackfill(dryRun, registryAddress, chainId)
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
