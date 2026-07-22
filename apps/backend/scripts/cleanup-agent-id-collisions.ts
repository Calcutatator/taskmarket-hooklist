import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../src/db/client';
import { agents } from '../src/db/schema';

// One-off cleanup for issue #208: indexer.ts's processIdentityEvents() used to
// create a bogus agents row for the backend's own relayer address (every
// identity registration is signed by that wallet, so the ERC-8004 registry's
// agentWallet metadata always defaulted to it, never the real end user's).
// That row then permanently squatted on whichever agent_id was minted first,
// colliding with the real owner's row. Run this once, before the migration
// that adds the agents.agent_id unique index, or that index creation fails
// outright on the still-existing duplicate.
//
// Usage: tsx scripts/cleanup-agent-id-collisions.ts --server-address 0x... [--dry-run]

function parseArgs(): { serverAddress: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const flagIndex = args.indexOf('--server-address');
  const serverAddress = flagIndex !== -1 ? args[flagIndex + 1] : undefined;
  if (!serverAddress) {
    console.error(
      'Usage: tsx scripts/cleanup-agent-id-collisions.ts --server-address 0x... [--dry-run]'
    );
    process.exit(1);
  }
  return { serverAddress: serverAddress.toLowerCase(), dryRun };
}

async function main() {
  const { serverAddress, dryRun } = parseArgs();
  const whereClause = and(eq(agents.address, serverAddress), isNotNull(agents.agentId));

  const existing = await db
    .select({ agentId: agents.agentId })
    .from(agents)
    .where(whereClause)
    .limit(1);
  const clearedAgentId = existing[0]?.agentId ?? null;

  if (!dryRun && clearedAgentId !== null) {
    await db.update(agents).set({ agentId: null, updatedAt: new Date() }).where(whereClause);
  }

  console.log(JSON.stringify({ dryRun, serverAddress, clearedAgentId }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
