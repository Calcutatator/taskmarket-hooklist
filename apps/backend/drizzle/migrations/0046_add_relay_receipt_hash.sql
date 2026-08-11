-- Implements: ADR-0071
-- The forwarder receipt key an intent's relay call consumes on success. Written at nonce
-- allocation so that an intent whose send never returned a hash still has an exact, per-intent
-- question to ask the chain later.
ALTER TABLE "relayed_intents" ADD COLUMN IF NOT EXISTS "relay_receipt_hash" text;

-- The stranded-intent sweep selects on (status, server_wallet_transaction_id, tx_hash) and only
-- ever wants the handful of rows in that state, so it must not read the whole table to find them.
CREATE INDEX IF NOT EXISTS "idx_relayed_intents_stranded"
  ON "relayed_intents" ("status", "server_wallet_transaction_id")
  WHERE "tx_hash" IS NULL;

-- The stale-intent counter on /api/health filters non-terminal statuses by "updated_at". That
-- endpoint is polled continuously, so the query has to be an index scan over the small
-- non-terminal tail rather than a filter applied after reading every row. The existing
-- "idx_relayed_intents_status" covers only the status half.
CREATE INDEX IF NOT EXISTS "idx_relayed_intents_status_updated_at"
  ON "relayed_intents" ("status", "updated_at");
