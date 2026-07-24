-- Ledger for x402 payments that settled (USDC left the payer's wallet into the
-- server wallet) but whose downstream on-chain action then failed, so no task
-- (or other paid-for resource) was ever created. Without this table a failed
-- create leaves no record anywhere that money moved -- see the createTask
-- payment-orphan incidents (2026-06-11, 2026-07-24). One row per orphaned
-- settlement; refund_status tracks whether the automatic refund (server wallet
-- -> payer) succeeded, so ops can find and manually resolve the ones that didn't.
CREATE TABLE IF NOT EXISTS "orphaned_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"payer" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"payment_tx_hash" text NOT NULL,
	"context" text NOT NULL,
	"failure_reason" text,
	"refund_status" text NOT NULL DEFAULT 'pending',
	"refund_tx_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
-- A UNIQUE constraint implicitly creates a same-named index; re-adding it against
-- an already-migrated DB fails on that index with duplicate_table (42P07), not
-- duplicate_object (42710) -- catch both so this is a genuine no-op on rerun.
DO $$ BEGIN
	ALTER TABLE "orphaned_payments" ADD CONSTRAINT "orphaned_payments_payment_tx_hash_unique" UNIQUE ("payment_tx_hash");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orphaned_payments_payer" ON "orphaned_payments" ("payer");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orphaned_payments_refund_status" ON "orphaned_payments" ("refund_status");
