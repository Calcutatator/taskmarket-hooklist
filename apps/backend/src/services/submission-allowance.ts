import { and, eq, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  FREE_SUBMISSION_ALLOWANCE,
  getFreeSubmissionAllowance,
  getHardSubmissionCeiling,
} from '../config/payments';
import type { db } from '../db/client';
import { submissions } from '../db/schema';
import { isOverFixedCeiling, type Transaction } from '../lib/rate-limit';

type Database = typeof db;

/**
 * Implements: ADR-0035, ADR-0037
 * RFC-0006 Tier 1 + Tier 2: submission-spam free-allowance metering and hard-ceiling
 * enforcement for bounty/benchmark tasks. See
 * docs/rfc/0006-submission-spam-free-allowance-pricing.md,
 * docs/adr/0035-submission-metering-bypasses-x402-not-price-at-zero.md, and
 * docs/adr/0037-tier-2-hard-ceiling-is-100-submissions.md.
 */

export { FREE_SUBMISSION_ALLOWANCE };

export const HARD_CEILING_MESSAGE =
  'This task has reached its maximum number of submissions from this worker.';

/**
 * Counts this worker's prior successful submissions to this task -- rows already
 * committed to the `submissions` table, i.e. submissions whose on-chain `submitWork`
 * call already succeeded (submissions.router.ts inserts the row only after
 * `contractSubmitWork` resolves). Deliberately never derived from middleware
 * attempts: `workerAddress` is unauthenticated at middleware time (signature
 * verification happens later, in the router), so counting attempts would let an
 * attacker burn another worker's free allowance by spamming this endpoint with a
 * spoofed address.
 *
 * A rejected submission still counts -- rejection happens after the row already
 * exists, so the submission was still "successful" in the sense this allowance
 * cares about (it consumed a real relay + on-chain call).
 */
export async function countSuccessfulSubmissions(
  database: Database | Transaction,
  taskId: string,
  workerAddress: string
): Promise<number> {
  const rows = await database
    .select({ value: sql<number>`count(*)::int` })
    .from(submissions)
    .where(
      and(
        eq(submissions.taskId, taskId),
        sql`lower(${submissions.workerAddress}) = lower(${workerAddress})`
      )
    );
  return Number(rows[0]?.value ?? 0);
}

/**
 * True while this worker still has free submissions left on this task (i.e. their
 * prior successful-submission count is below the effective allowance --
 * getFreeSubmissionAllowance(), which honors the SUBMISSION_FREE_ALLOWANCE env override
 * used by smoke tests; see config/payments.ts). Callers combine this with the task's mode
 * (bounty/benchmark only, per RFC-0006) before deciding whether to bypass x402Middleware
 * -- see apps/backend/src/middleware/submissionAllowanceGate.ts.
 */
export async function isWithinFreeSubmissionAllowance(
  database: Database | Transaction,
  taskId: string,
  workerAddress: string
): Promise<boolean> {
  const priorCount = await countSuccessfulSubmissions(database, taskId, workerAddress);
  return priorCount < getFreeSubmissionAllowance();
}

/**
 * Implements: ADR-0037
 * RFC-0006 Tier 2: true once this worker's successful-submission count on this task has
 * reached (or passed) the effective hard ceiling (getHardSubmissionCeiling() -- honors the
 * HARD_SUBMISSION_CEILING env override used by smoke tests; see config/payments.ts) -- an
 * absolute, permanent bound independent of Tier 1's free allowance or pricing. Thin wrapper
 * over the shared module's generic `isOverFixedCeiling` (apps/backend/src/lib/rate-limit.ts,
 * ADR-0038); reuses `countSuccessfulSubmissions` as-is -- no new query, no new table, only
 * the threshold is new. See apps/backend/src/middleware/submissionAllowanceGate.ts for where
 * this is checked (before the free-allowance check).
 */
export async function isOverHardSubmissionCeiling(
  database: Database | Transaction,
  taskId: string,
  workerAddress: string
): Promise<boolean> {
  return isOverFixedCeiling(database, {
    count: () => countSuccessfulSubmissions(database, taskId, workerAddress),
    ceiling: getHardSubmissionCeiling(),
  });
}

/**
 * Implements: ADR-0037
 * submissionAllowanceGate's own hard-ceiling check runs in middleware, before file
 * uploads and the slow on-chain submitWork call -- a real gap between that read and the
 * eventual `tx.insert(submissions)` in submissions.router.ts, wide enough for concurrent
 * requests to all read the same under-ceiling count and all proceed. Call this immediately
 * before the insert, inside the same transaction that performs it, to close that window:
 * a transaction-scoped Postgres advisory lock keyed on (taskId, workerAddress) serializes
 * concurrent submitters to the same task around the count-then-insert step (auto-released
 * on commit or rollback -- no cleanup needed, no new table, no owned state beyond the lock
 * itself), then re-reads the count through the lock and re-validates the ceiling. Throws
 * rather than returning a boolean -- there is no valid "proceed anyway" path once the
 * caller is already inside the insert transaction.
 */
export async function assertUnderHardSubmissionCeilingForInsert(
  tx: Transaction,
  taskId: string,
  workerAddress: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${taskId} || lower(${workerAddress}), 0))`
  );
  if (await isOverHardSubmissionCeiling(tx, taskId, workerAddress)) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: HARD_CEILING_MESSAGE });
  }
}
