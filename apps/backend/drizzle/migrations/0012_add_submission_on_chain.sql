ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "deliverable_hash" text;
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "submit_tx_hash" text;
