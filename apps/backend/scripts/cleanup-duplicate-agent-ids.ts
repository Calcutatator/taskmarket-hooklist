import { sql } from 'drizzle-orm';
import { db } from '../src/db/client';
import { agents } from '../src/db/schema';

// A distinct duplicate-agent_id class from cleanup-agent-id-collisions.ts's
// server-relayer-address bug: rows here don't share a common address across
// groups, so they aren't caused by indexer.ts inserting a bogus row for the
// server's own relayer address. Root cause: contractRegisterIdentity()'s RPC-lag
// getLogs fallback (apps/backend/src/services/contract.ts, fixed alongside this
// script) wasn't scoped to its own transaction hash, so two /identity/register
// calls landing in the same block could each read back the OTHER call's
// Registered event and get handed the same agentId. Each transaction still minted
// its own distinct, correct agentId on-chain -- the bug was purely in which
// agentId the backend attributed to which row.
//
// Must run before migration 0034_agents_agent_id_unique.sql (agents.agent_id
// uniqueness, PR #224) deploys, or CREATE UNIQUE INDEX fails outright on any
// still-existing duplicate and crash-loops the backend boot.
//
// Safety: only resolves a group automatically when every row in it is fully
// dormant (completed_tasks, rated_tasks, and total_earnings all zero). A group
// with any activity on any row is left untouched and reported separately --
// guessing which row is "real" risks nulling out a real user's legitimate
// agentId, exactly the failure this cleanup exists to prevent.
type AgentRow = {
  address: string;
  agentId: string;
  completedTasks: number;
  ratedTasks: number;
  totalEarnings: string;
  createdAt: string | null;
};

async function runDuplicateAgentIdCleanup(dryRun: boolean) {
  const rows = (await db.execute(sql`
    SELECT address, agent_id AS "agentId", completed_tasks AS "completedTasks",
           rated_tasks AS "ratedTasks", total_earnings AS "totalEarnings",
           created_at AS "createdAt"
    FROM agents
    WHERE agent_id IN (
      SELECT agent_id FROM agents WHERE agent_id IS NOT NULL GROUP BY agent_id HAVING count(*) > 1
    )
    ORDER BY agent_id, created_at ASC NULLS FIRST, address ASC
  `)) as unknown as AgentRow[];

  const groups = new Map<string, AgentRow[]>();
  for (const row of rows) {
    const group = groups.get(row.agentId) ?? [];
    group.push(row);
    groups.set(row.agentId, group);
  }

  const cleared: { agentId: string; keptAddress: string; clearedAddresses: string[] }[] = [];
  const skipped: { agentId: string; reason: string; addresses: string[] }[] = [];

  for (const [agentId, group] of groups) {
    const hasActivity = group.some(
      (row) => row.completedTasks !== 0 || row.ratedTasks !== 0 || row.totalEarnings !== '0'
    );
    if (hasActivity) {
      skipped.push({
        agentId,
        reason: 'at least one row in this group has non-zero activity -- needs manual review',
        addresses: group.map((row) => row.address),
      });
      continue;
    }

    const [keep, ...rest] = group;
    cleared.push({
      agentId,
      keptAddress: keep.address,
      clearedAddresses: rest.map((row) => row.address),
    });

    if (!dryRun) {
      for (const row of rest) {
        await db
          .update(agents)
          .set({ agentId: null, identityRegistryAddress: null, chainId: null })
          .where(sql`${agents.address} = ${row.address}`);
      }
    }
  }

  return {
    dryRun,
    totalDuplicateGroups: groups.size,
    resolvedGroups: cleared.length,
    clearedRows: cleared.reduce((sum, group) => sum + group.clearedAddresses.length, 0),
    cleared,
    skippedGroups: skipped.length,
    skipped,
  };
}

const dryRun = process.argv.includes('--dry-run');

runDuplicateAgentIdCleanup(dryRun)
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
