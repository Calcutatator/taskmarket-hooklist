-- Backfill claimedBy for any in-flight task whose pre-completion assignment was
-- only ever recorded via `worker` (before this PR's fix, pitches.selectWorker
-- and bids.selectWinner did not write claimedBy). Must run before the DROP
-- COLUMN below or this assignment signal is lost for any task mid-flight in a
-- deployed environment at migration time.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'worker'
  ) THEN
    EXECUTE 'UPDATE "tasks" SET "claimed_by" = "worker" WHERE "claimed_by" IS NULL AND "worker" IS NOT NULL';
  END IF;
END $$;

-- Belt-and-suspenders on top of ADR-0003's fail-fast boot guarantee: every
-- status='completed' task under the currently-active contract must already
-- have at least one task_awards row -- except a legitimate no-payout
-- evaluator/dispute verdict, which the contract settles with zero
-- TaskCompleted events by design (fees consume the entire escrow; see
-- evaluations.router.ts's finalizeVerdict/resolveDispute all-zero-award
-- branches, and docs/DB_GUIDE.md). Those tasks always have verdict_type set
-- (only reachable via the evaluate() -> finalizeVerdict/resolveDispute
-- path), so exclude them here rather than mirroring
-- task-awards-backfill.ts's on-chain isNoPayoutVerdict check, which a
-- migration cannot perform.
--
-- Scoped to the currently-active contract because the task_awards backfill
-- only ever scans the app's currently-configured CONTRACT_ADDRESS -- a
-- completed task under any other address, or with no contract_address
-- recorded at all, belongs to a retired deployment or predates
-- contract_address tracking and can never be resolved by that backfill.
-- Unscoped, this guard permanently blocks on exactly that class of row
-- regardless of how thoroughly the backfill runs; confirmed live on both a
-- production database (one task with a null contract_address, fixed by hand
-- once found) and testnet (over a hundred tasks across two retired contract
-- addresses plus untracked ones). See ADR-0008.
--
-- "Currently active" is derived from the *most recently created* task's
-- contract_address, not the most common one -- an actively-redeployed
-- testnet accumulates far more historical volume on retired addresses than
-- the newest one has had time to collect, so a most-common vote picks the
-- wrong contract entirely (confirmed live: the real active testnet contract
-- had the fewest tasks of the three addresses present). Whichever address
-- created the most recent task is unambiguously the one new tasks are
-- landing on right now.
DO $$
DECLARE
  missing_count integer;
  current_contract text;
BEGIN
  SELECT contract_address INTO current_contract
  FROM "tasks"
  WHERE "contract_address" IS NOT NULL AND "contract_address" <> ''
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT count(*) INTO missing_count
  FROM "tasks" t
  WHERE t."status" = 'completed'
    AND t."verdict_type" IS NULL
    AND lower(t."contract_address") = lower(current_contract)
    AND NOT EXISTS (SELECT 1 FROM "task_awards" a WHERE a."task_id" = t."id");
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Cannot drop tasks.worker/tasks.rating: % completed task(s) under the active contract (%) have no task_awards row', missing_count, current_contract;
  END IF;
END $$;

DROP INDEX IF EXISTS "idx_tasks_worker";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "worker";
ALTER TABLE "tasks" DROP COLUMN IF EXISTS "rating";
