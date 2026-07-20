-- Idempotency table for the on-chain event indexer.
--
-- The previous indexer re-ran handlers on the same (chainId, blockNumber, logIndex)
-- whenever it restarted or processed an overlapping range, which silently corrupted
-- agents.totalEarnings and agents.completedTasks (SQL `+` aggregation in the
-- TaskAccepted handler). Every handler now short-circuits if the matching row in
-- indexed_events already exists; on success it inserts a row.
--
-- Primary key is the natural (chain_id, block_number, log_index) tuple. tx_hash is
-- a non-key column kept for diagnostics ("why was this event processed/missed?").
CREATE TABLE IF NOT EXISTS "indexed_events" (
  "chain_id" integer NOT NULL,
  "block_number" bigint NOT NULL,
  "log_index" integer NOT NULL,
  "event_name" text NOT NULL,
  "tx_hash" text NOT NULL,
  "processed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("chain_id", "block_number", "log_index")
);
