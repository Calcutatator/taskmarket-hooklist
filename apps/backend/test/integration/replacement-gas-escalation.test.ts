// Verifies: ADR-0051
//
// Escalation is only correct if attempt n is priced from what attempt n-1 actually paid. The
// pure arithmetic already has unit coverage (test/unit/lib/replacement-gas.test.ts); what has
// none is the part that carries the previous fee across a pass -- the reconciler handing the
// fee it used to the store, the store persisting it into `last_max_fee_per_gas`, and the next
// pass reading it back out as `previousFees`. That round trip is where ADR-0051's defect lived:
// `sendReplacement(nonce)` could not see the previous fee at all, so it multiplied a freshly
// read oracle instead, and on a flat oracle every replacement was priced identically and
// rejected by the node for an insufficient bump.
//
// So this test runs the real reconciler against a real migrated Postgres through the real
// Drizzle store, with a deliberately FLAT oracle. A flat oracle is what makes the assertion
// mean something: under the old behaviour the second replacement would come out at exactly the
// same price as the first, and the strict-increase assertion below is what fails.
//
// ## Why this is not a smoke test
//
// A smoke would have to keep a transaction unmined across two 90-second reconciler passes.
// Anvil mines instantly, so a replacement lands the moment it is broadcast and no second
// replacement is ever priced -- the only way to prevent that is `evm_setAutomine(false)`, which
// freezes the entire shared stack for the duration and leaves it frozen if the script dies
// between disabling and re-enabling it. Escalation is chain-independent arithmetic over
// persisted state, so nothing about it needs a chain; the parts that do need one (the
// reconciler clearing a stranded nonce end to end) are already covered by smoke-nonce.ts.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverWalletTransactions } from '../../src/db/schema';
import { computeReplacementFees, type ReplacementGasPolicy } from '../../src/lib/replacement-gas';
import type { GasFees } from '../../src/lib/server-transaction-store';
import { createIsolatedMigratedDatabase } from '../helpers/integration-database';
import { stubServerEnvironment } from '../helpers/server-environment';

// Built from the ambient DATABASE_URL before anything is stubbed, so this suite still skips
// itself where no integration database exists rather than running against a stub URL.
const isolatedDatabase = createIsolatedMigratedDatabase('replacementgas');

// The reconciler logs, and the logger reads validated server config at import time -- so the
// module has to be pulled in after the environment exists, exactly as its unit test does.
const restoreServerEnvironment = stubServerEnvironment();
const { createServerTransactionReconciler } =
  await import('../../src/lib/server-transaction-reconciler');
const { createDrizzleServerTransactionStore } =
  await import('../../src/lib/server-transaction-store');
afterAll(restoreServerEnvironment);
const describeWithDatabase = isolatedDatabase.isAvailable ? describe : describe.skip;
const { database } = isolatedDatabase;

const CHAIN_ID = 31337;
const WALLET = '0x00000000000000000000000000000000000000aa';
const STUCK_AFTER_MS = 90_000;

/** The shipped defaults (ADR-0051 section 4), as readReplacementGasPolicy would produce them. */
const POLICY: ReplacementGasPolicy = {
  escalationPct: 150n,
  firstBumpPct: 200n,
  maxFeeWei: null,
  maxMultiple: 10n,
};

/**
 * Deliberately unchanging between passes.
 *
 * The market not moving is the case the old code got wrong, and the case a fee oracle cannot
 * help with: if the reason a transaction is stuck has nothing to do with price, re-reading the
 * price produces the same number for ever.
 */
const FLAT_ORACLE: GasFees = { maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 100_000n };
const ORIGINAL_FEES: GasFees = { maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 100_000n };
/** What a replacement priced purely off the flat oracle would cost, on every pass alike. */
const OPENING_BID = (FLAT_ORACLE.maxFeePerGas * POLICY.firstBumpPct) / 100n;

function buildReconciler() {
  const store = createDrizzleServerTransactionStore({
    chainId: CHAIN_ID,
    database,
    newId: () => randomUUID(),
    walletAddress: WALLET,
  });

  // The same composition lib/wallet.ts performs, minus the broadcast itself: read the oracle,
  // price the attempt from the fee history the reconciler passed in, hand the fee actually used
  // back so it can be persisted for the attempt after this one.
  const pricedAttempts: GasFees[] = [];
  const reconcileOnce = createServerTransactionReconciler({
    getReceiptStatus: async () => null,
    sendReplacement: async ({ originalFees, previousFees }) => {
      const decision = computeReplacementFees({
        oracle: FLAT_ORACLE,
        original: originalFees,
        policy: POLICY,
        previous: previousFees,
      });
      pricedAttempts.push(decision.fees);
      return {
        fees: decision.fees,
        hash: `0x${randomUUID().replaceAll('-', '')}` as `0x${string}`,
      };
    },
    store,
    stuckAfterMs: STUCK_AFTER_MS,
  });

  return { pricedAttempts, reconcileOnce };
}

async function seedStuckTransaction(id: string, nonce: number): Promise<void> {
  const longAgo = new Date(Date.now() - STUCK_AFTER_MS * 10);
  await database.insert(serverWalletTransactions).values({
    broadcastAt: longAgo,
    chainId: CHAIN_ID,
    id,
    lastMaxFeePerGas: ORIGINAL_FEES.maxFeePerGas.toString(),
    lastMaxPriorityFeePerGas: ORIGINAL_FEES.maxPriorityFeePerGas.toString(),
    nonce,
    originalMaxFeePerGas: ORIGINAL_FEES.maxFeePerGas.toString(),
    originalMaxPriorityFeePerGas: ORIGINAL_FEES.maxPriorityFeePerGas.toString(),
    status: 'broadcast',
    txHash: `0x${'1'.repeat(64)}`,
    updatedAt: longAgo,
    walletAddress: WALLET,
  });
}

async function readRow(id: string) {
  const [row] = await database
    .select()
    .from(serverWalletTransactions)
    .where(eq(serverWalletTransactions.id, id));
  if (!row) throw new Error(`No server_wallet_transactions row for ${id}`);
  return row;
}

/** Push the row's broadcast time back so the next pass sees it as stuck again. */
async function makeStuckAgain(id: string): Promise<void> {
  const longAgo = new Date(Date.now() - STUCK_AFTER_MS * 10);
  await database
    .update(serverWalletTransactions)
    .set({ broadcastAt: longAgo, updatedAt: longAgo })
    .where(eq(serverWalletTransactions.id, id));
}

describeWithDatabase('replacement gas escalation across reconciler passes', () => {
  beforeAll(async () => {
    await isolatedDatabase.start();
  });

  afterAll(async () => {
    await isolatedDatabase.stop();
  });

  it('prices each replacement from the previous attempt, not a re-read oracle', async () => {
    const id = `replacement-gas-${randomUUID()}`;
    await seedStuckTransaction(id, 7);
    const { pricedAttempts, reconcileOnce } = buildReconciler();

    await reconcileOnce();
    const afterFirst = await readRow(id);
    const firstFee = BigInt(afterFirst.lastMaxFeePerGas!);

    await makeStuckAgain(id);
    await reconcileOnce();
    const afterSecond = await readRow(id);
    const secondFee = BigInt(afterSecond.lastMaxFeePerGas!);

    expect(pricedAttempts).toHaveLength(2);

    // The property that matters, stated as bluntly as possible: the node rejects a replacement
    // that does not outbid its predecessor, so an escalation that is not strictly increasing is
    // not an escalation.
    expect(secondFee).toBeGreaterThan(firstFee);

    // And the specific way the old code failed, named. On this flat oracle a replacement priced
    // off the oracle is OPENING_BID every single time, so the second attempt landing on that
    // number is the regression rather than merely a different number.
    expect(firstFee).toBe(OPENING_BID);
    expect(secondFee).not.toBe(OPENING_BID);
    expect(secondFee).toBe((firstFee * POLICY.escalationPct) / 100n);

    // The cap is a multiple of the ORIGINAL fee, so the original must not move as attempts
    // escalate -- if it tracked the last attempt the ceiling would climb with the fee it bounds.
    expect(BigInt(afterSecond.originalMaxFeePerGas!)).toBe(ORIGINAL_FEES.maxFeePerGas);
    expect(afterSecond.attempts).toBe(2);
  });

  it('holds at the cap instead of climbing past it, and stays there', async () => {
    const id = `replacement-gas-capped-${randomUUID()}`;
    await seedStuckTransaction(id, 11);
    const { reconcileOnce } = buildReconciler();

    // maxMultiple is 10 and the ladder from OPENING_BID (2x) climbs by 50% a pass, so the cap
    // binds within a handful of passes. Clamping is not the same as stopping: ADR-0051 point 2
    // is explicit that clearing a nonce never gives up, so the passes keep going at the cap.
    const ceiling = ORIGINAL_FEES.maxFeePerGas * POLICY.maxMultiple;
    let previousFee = 0n;
    for (let pass = 0; pass < 8; pass++) {
      await makeStuckAgain(id);
      await reconcileOnce();
      const fee = BigInt((await readRow(id)).lastMaxFeePerGas!);
      expect(fee).toBeLessThanOrEqual(ceiling);
      expect(fee).toBeGreaterThanOrEqual(previousFee);
      previousFee = fee;
    }
    expect(previousFee).toBe(ceiling);
  });
});
