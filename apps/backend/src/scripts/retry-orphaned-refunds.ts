import { db } from '../db/client';
import { retryFailedOrphanedRefunds } from '../services/orphaned-payments';
import { orphanedPayments } from '../db/schema';
import { eq } from 'drizzle-orm';

// Run this after fixing whatever blocked a batch of automatic refunds -- most
// commonly the server wallet (SERVER_PRIVATE_KEY) running out of ETH for gas, which
// fails the refund transfer the exact same way it fails the original relayed action
// it was refunding (see the createTask payment-orphan incidents, 2026-06-11 and
// 2026-07-24, and the "forwarder wallet ran out of gas" variant of the same failure).
// Top up the server wallet's ETH balance first, then run this with no flags.
async function main(dryRun: boolean) {
  if (dryRun) {
    const failedRows = await db
      .select({
        id: orphanedPayments.id,
        payer: orphanedPayments.payer,
        amount: orphanedPayments.amount,
        paymentTxHash: orphanedPayments.paymentTxHash,
        context: orphanedPayments.context,
      })
      .from(orphanedPayments)
      .where(eq(orphanedPayments.refundStatus, 'failed'));
    return { dryRun: true, wouldRetry: failedRows };
  }

  const results = await retryFailedOrphanedRefunds(db);
  return {
    dryRun: false,
    retried: results.length,
    refunded: results.filter((r) => r.refunded).length,
    stillFailed: results.filter((r) => !r.refunded).length,
    results,
  };
}

const dryRun = process.argv.includes('--dry-run');

main(dryRun)
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
