-- Migration 0023 (add_requester_reputation_events) was supposed to create a unique
-- index on task_id, but at least the local dev database and the shared testnet
-- database ended up with only a plain (non-unique) index instead -- drift from
-- whatever ran that migration originally, cause not reconstructable at this point.
--
-- recordRequesterReputationEvent's insert uses `ON CONFLICT ("task_id") DO NOTHING`,
-- which requires a real unique constraint/index to exist on that column; without one,
-- every insert fails with Postgres error 42P10 ("no unique or exclusion constraint
-- matching the ON CONFLICT specification"). Per ADR-0005, the indexer's main event
-- stream blocks on a failed event rather than skipping it, so this silently halted
-- all further event indexing on both the affected databases from the first
-- TaskCompleted event processed after the drift -- confirmed live on both.
--
-- IF NOT EXISTS makes this safe to run against a database that already has the
-- correct unique index (a fresh deploy from migration 0023 onward never hits this).
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_requester_rep_task" ON "requester_reputation_events" ("task_id");

-- Drop the stray plain (non-unique) index left over from the same drift -- it is not
-- declared in schema.ts (only the unique index and the requester index are) and is
-- now fully redundant with the unique index above.
DROP INDEX IF EXISTS "requester_reputation_events_task_id_idx";
