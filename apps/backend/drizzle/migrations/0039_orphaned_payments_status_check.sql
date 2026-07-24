-- Restrict orphaned_payments.refund_status to its known set at the DB level, matching
-- the existing task_drop_announcement_deliveries.status precedent -- catches a typo'd
-- status value at write time instead of silently corrupting the ledger that
-- scripts/retry-orphaned-refunds.ts and ops rely on to find stuck refunds.
-- 'refunding' is a transient claim state (see attemptRefund in
-- services/orphaned-payments.ts): a row is flipped from 'pending'/'failed' to
-- 'refunding' by a single conditional UPDATE immediately before the refund transfer
-- is sent, so a concurrent retry attempt on the same row sees it's no longer
-- claimable and backs off instead of sending a second transfer.
DO $$ BEGIN
	ALTER TABLE "orphaned_payments" ADD CONSTRAINT "orphaned_payments_refund_status_check"
		CHECK ("refund_status" IN ('pending', 'refunding', 'refunded', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
