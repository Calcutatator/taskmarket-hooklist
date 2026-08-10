-- Implements: ADR-0078
-- The intent's chain. The outbox row beneath it has carried chain_id since ADR-0040; the intent
-- above it did not, so its idempotency key and payment reference were unique globally rather than
-- per chain. One backend serving two chains would collide on both.
--
-- Added with a 0 sentinel so existing rows have a value, then backfilled from the outbox row each
-- intent names -- that row already knows the correct chain. Rows with no outbox row (reservations,
-- and intents that never broadcast) keep 0, which preserves the previous global uniqueness among
-- exactly those rows. The default is dropped afterwards so every new row must state its chain.
ALTER TABLE "relayed_intents" ADD COLUMN IF NOT EXISTS "chain_id" integer NOT NULL DEFAULT 0;

UPDATE "relayed_intents" AS ri
SET "chain_id" = swt."chain_id"
FROM "server_wallet_transactions" AS swt
WHERE ri."server_wallet_transaction_id" = swt."id"
  AND ri."chain_id" = 0;

ALTER TABLE "relayed_intents" ALTER COLUMN "chain_id" DROP DEFAULT;

-- The uniqueness rules this migration exists for. Dropped and rebuilt composite: a key names one
-- operation on one chain (ADR-0052), and a payment hash is only unique within its chain.
DROP INDEX IF EXISTS "idx_relayed_intents_idempotency_key";
DROP INDEX IF EXISTS "idx_relayed_intents_payment_tx";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_relayed_intents_chain_idempotency_key"
  ON "relayed_intents" ("chain_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_relayed_intents_chain_payment_tx"
  ON "relayed_intents" ("chain_id", "payment_tx_hash");
