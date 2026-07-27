/**
 * One-time data migration for ADR 0020 (docs/adr/0020-normalize-wallet-addresses.md).
 *
 * Lowercases every existing `agents.address`, `devices.wallet_address`,
 * `agents.withdrawal_address`, and the address columns of every table with a
 * foreign key into `agents.address` (`agent_xmtp_installations.agent_address`,
 * `agent_xmtp_peer_policies.owner_agent_address`, `emails.agent_address`).
 * Needed before/alongside deploying the code from that ADR: once the backend
 * normalizes addresses on write, any *existing* row still stored in
 * checksummed form would fail to match on
 * `onConflictDoUpdate`/`onConflictDoNothing` (Postgres text primary-key
 * conflict detection is exact-match, not case-insensitive) the next time
 * that agent's write path fires -- creating a fresh duplicate row instead
 * of updating the real one.
 *
 * Why the FK-referencing tables matter: all three FKs into `agents.address`
 * are `ON UPDATE NO ACTION` (verified against production and testnet before
 * writing this). Lowering `agents.address` alone would immediately violate
 * those constraints for any agent with existing installations, peer
 * policies, or emails, since the child rows would still hold the old
 * (checksummed) value referencing an address that no longer exists in
 * `agents`. This script defers all three constraints for the duration of a
 * single transaction (permanently altering them to DEFERRABLE INITIALLY
 * DEFERRED -- a safe, standard change that only affects *when* the
 * constraint is checked, not the integrity guarantee itself) so every
 * table's address column can be normalized together, with the FK checks
 * only running at COMMIT once everything is consistent.
 *
 * Safety:
 *  - Runs a pre-check for any `agents.address` that would collide with
 *    another row once lowercased. Aborts with no changes if any are found --
 *    resolve those manually first (see the incident this ADR was discovered
 *    during).
 *  - Defaults to dry-run (reports what would change, makes no writes).
 *    Pass --execute to actually apply.
 *  - Everything (the constraint ALTERs and every UPDATE) runs inside one
 *    transaction -- if anything fails, nothing is applied.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... tsx src/scripts/normalize-address-casing.ts            # dry run
 *   DATABASE_URL=postgresql://... tsx src/scripts/normalize-address-casing.ts --execute   # apply
 *
 * Run against every environment that has its own database (production,
 * testnet) before merging the ADR 0020 PR.
 */
import { db } from '../db/client';
import { sql } from 'drizzle-orm';

const EXECUTE = process.argv.includes('--execute');

const FK_CONSTRAINTS = [
  {
    table: 'agent_xmtp_installations',
    constraint: 'agent_xmtp_installations_agent_address_agents_address_fk',
  },
  {
    table: 'agent_xmtp_peer_policies',
    constraint: 'agent_xmtp_peer_policies_owner_agent_address_agents_address_fk',
  },
  { table: 'emails', constraint: 'emails_agent_address_agents_address_fk' },
] as const;

async function countPending() {
  const [agentsN, devicesN, withdrawalN, installationsN, peerPoliciesN, emailsN] =
    await Promise.all([
      db.execute(sql`SELECT count(*)::int AS n FROM agents WHERE address != lower(address)`),
      db.execute(
        sql`SELECT count(*)::int AS n FROM devices WHERE wallet_address != lower(wallet_address)`
      ),
      db.execute(sql`
      SELECT count(*)::int AS n FROM agents
      WHERE withdrawal_address IS NOT NULL AND withdrawal_address != lower(withdrawal_address)
    `),
      db.execute(sql`
      SELECT count(*)::int AS n FROM agent_xmtp_installations WHERE agent_address != lower(agent_address)
    `),
      db.execute(sql`
      SELECT count(*)::int AS n FROM agent_xmtp_peer_policies
      WHERE owner_agent_address != lower(owner_agent_address)
    `),
      db.execute(
        sql`SELECT count(*)::int AS n FROM emails WHERE agent_address != lower(agent_address)`
      ),
    ]);
  const n = (r: Awaited<ReturnType<typeof db.execute>>) => (r[0] as unknown as { n: number }).n;
  return {
    agents: n(agentsN),
    devices: n(devicesN),
    withdrawal: n(withdrawalN),
    installations: n(installationsN),
    peerPolicies: n(peerPoliciesN),
    emails: n(emailsN),
  };
}

async function main() {
  console.log(`=== normalize-address-casing (${EXECUTE ? 'EXECUTE' : 'DRY RUN'}) ===`);

  const collisions = await db.execute(sql`
    SELECT lower(address) AS addr, array_agg(address ORDER BY address) AS variants
    FROM agents
    GROUP BY lower(address)
    HAVING count(*) > 1
  `);

  if (collisions.length > 0) {
    console.error(
      `ABORTING: ${collisions.length} address(es) would collide if lowercased. Resolve these manually first:`
    );
    for (const row of collisions as unknown as Array<{ addr: string; variants: string[] }>) {
      console.error(`  ${row.addr}: ${row.variants.join(', ')}`);
    }
    process.exit(1);
  }
  console.log('Pre-check passed: no agents.address rows would collide when lowercased.');

  // agent_xmtp_peer_policies has a unique constraint on
  // (owner_agent_address, peer_inbox_id) -- lowering owner_agent_address
  // could collide two rows for the same peer_inbox_id the same way
  // agents.address could collide on its own primary key.
  const peerPolicyCollisions = await db.execute(sql`
    SELECT lower(owner_agent_address) AS addr, peer_inbox_id, count(*)::int AS n
    FROM agent_xmtp_peer_policies
    GROUP BY lower(owner_agent_address), peer_inbox_id
    HAVING count(*) > 1
  `);

  if (peerPolicyCollisions.length > 0) {
    console.error(
      `ABORTING: ${peerPolicyCollisions.length} agent_xmtp_peer_policies (owner_agent_address, peer_inbox_id) pair(s) would collide if lowercased. Resolve these manually first:`
    );
    for (const row of peerPolicyCollisions as unknown as Array<{
      addr: string;
      peer_inbox_id: string;
      n: number;
    }>) {
      console.error(`  ${row.addr} / ${row.peer_inbox_id}: ${row.n} rows`);
    }
    process.exit(1);
  }
  console.log(
    'Pre-check passed: no agent_xmtp_peer_policies rows would collide when lowercased.\n'
  );

  const pending = await countPending();
  console.log(`agents.address rows to normalize: ${pending.agents}`);
  console.log(`devices.wallet_address rows to normalize: ${pending.devices}`);
  console.log(`agents.withdrawal_address rows to normalize: ${pending.withdrawal}`);
  console.log(`agent_xmtp_installations.agent_address rows to normalize: ${pending.installations}`);
  console.log(
    `agent_xmtp_peer_policies.owner_agent_address rows to normalize: ${pending.peerPolicies}`
  );
  console.log(`emails.agent_address rows to normalize: ${pending.emails}`);

  if (!EXECUTE) {
    console.log('\nDry run only -- no changes made. Re-run with --execute to apply.');
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    for (const { table, constraint } of FK_CONSTRAINTS) {
      await tx.execute(
        sql.raw(`ALTER TABLE ${table} ALTER CONSTRAINT ${constraint} DEFERRABLE INITIALLY DEFERRED`)
      );
      await tx.execute(sql.raw(`SET CONSTRAINTS ${constraint} DEFERRED`));
    }

    const agentsResult = await tx.execute(sql`
      UPDATE agents SET address = lower(address) WHERE address != lower(address)
    `);
    console.log(`agents.address: ${agentsResult.count} row(s) updated`);

    const devicesResult = await tx.execute(sql`
      UPDATE devices SET wallet_address = lower(wallet_address) WHERE wallet_address != lower(wallet_address)
    `);
    console.log(`devices.wallet_address: ${devicesResult.count} row(s) updated`);

    const withdrawalResult = await tx.execute(sql`
      UPDATE agents SET withdrawal_address = lower(withdrawal_address)
      WHERE withdrawal_address IS NOT NULL AND withdrawal_address != lower(withdrawal_address)
    `);
    console.log(`agents.withdrawal_address: ${withdrawalResult.count} row(s) updated`);

    const installationsResult = await tx.execute(sql`
      UPDATE agent_xmtp_installations SET agent_address = lower(agent_address)
      WHERE agent_address != lower(agent_address)
    `);
    console.log(
      `agent_xmtp_installations.agent_address: ${installationsResult.count} row(s) updated`
    );

    const peerPoliciesResult = await tx.execute(sql`
      UPDATE agent_xmtp_peer_policies SET owner_agent_address = lower(owner_agent_address)
      WHERE owner_agent_address != lower(owner_agent_address)
    `);
    console.log(
      `agent_xmtp_peer_policies.owner_agent_address: ${peerPoliciesResult.count} row(s) updated`
    );

    const emailsResult = await tx.execute(sql`
      UPDATE emails SET agent_address = lower(agent_address) WHERE agent_address != lower(agent_address)
    `);
    console.log(`emails.agent_address: ${emailsResult.count} row(s) updated`);
  });

  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
