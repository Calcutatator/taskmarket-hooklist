-- ADR-0067: an intent is reserved when the request arrives, before the payment challenge.
--
-- Every statement is written to be a safe no-op when re-applied, per AGENTS.md.

-- Whether this write is one somebody has to pay for. Defaults to false, which is the correct
-- reading of every row that already exists: they were all created after settlement, so a row
-- with no payment reference today is a free relayed write, exactly as the old rule said.
ALTER TABLE "relayed_intents" ADD COLUMN IF NOT EXISTS "payment_required" boolean DEFAULT false NOT NULL;

-- Backfill: an existing row carrying a payment reference is a paid write, and must not read as
-- a free one once the sweeps start consulting this column.
UPDATE "relayed_intents" SET "payment_required" = true
  WHERE "payment_required" = false AND ("payment_tx_hash" IS NOT NULL OR "payment_amount" IS NOT NULL);

-- The write-ahead record of the EIP-3009 authorization, written before the facilitator is asked
-- to settle it. A record of an attempt, never evidence that money moved.
ALTER TABLE "relayed_intents" ADD COLUMN IF NOT EXISTS "payment_auth_nonce" text;
ALTER TABLE "relayed_intents" ADD COLUMN IF NOT EXISTS "payment_auth_payer" text;
ALTER TABLE "relayed_intents" ADD COLUMN IF NOT EXISTS "payment_auth_amount" numeric(78, 0);

-- When a reservation stops being one. Null on every existing row and on every filled intent.
ALTER TABLE "relayed_intents" ADD COLUMN IF NOT EXISTS "reserved_expires_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "idx_relayed_intents_reserved_expires_at" ON "relayed_intents" ("reserved_expires_at");

-- 'reserved' joins the status domain. Dropping and re-adding is the portable way to widen a
-- CHECK; both halves are guarded so a re-run is a no-op rather than an error.
ALTER TABLE "relayed_intents" DROP CONSTRAINT IF EXISTS "relayed_intents_status_check";
DO $$ BEGIN
  ALTER TABLE "relayed_intents" ADD CONSTRAINT "relayed_intents_status_check"
    CHECK ("status" IN ('reserved', 'recorded', 'broadcast', 'completed', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
