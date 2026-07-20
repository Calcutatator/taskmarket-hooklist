-- Audit log for protocol-level admin events emitted by TaskMarket:
-- FeesUpdated, FeeRecipientUpdated, ForwarderUpdated, ReputationRegistryUpdated.
-- These are not user-facing in the task lifecycle, but indexing them gives us a
-- queryable history of every protocol config change with full provenance.
--
-- args is JSONB so we can store each event's payload generically (e.g.
-- `{"newFeeBps": 500}` or `{"forwarder": "0x...", "trusted": true}`) without
-- needing a column per event type.
CREATE TABLE IF NOT EXISTS "protocol_events" (
  "id" serial PRIMARY KEY,
  "event_name" text NOT NULL,
  "chain_id" integer NOT NULL,
  "block_number" bigint NOT NULL,
  "log_index" integer NOT NULL,
  "tx_hash" text NOT NULL,
  "args" jsonb NOT NULL,
  "emitted_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "protocol_events_chain_block_log_unique"
  ON "protocol_events" ("chain_id", "block_number", "log_index");
CREATE INDEX IF NOT EXISTS "idx_protocol_events_name" ON "protocol_events" ("event_name");
CREATE INDEX IF NOT EXISTS "idx_protocol_events_block" ON "protocol_events" ("block_number");
