-- Stats data layer (Phase 1).
--
-- Adds timestamp indexes used by the time-series / activity-feed queries in
-- stats.router, plus a new append-only agents.created_at column that powers the
-- "new agents per day" metric. All statements are idempotent (IF NOT EXISTS /
-- ON CONFLICT) so re-running the migration is safe.

-- Timestamp indexes for bucketed time-series scans. Only added where genuinely
-- absent today (these timestamp columns previously had no index).
CREATE INDEX IF NOT EXISTS "idx_tasks_created_at" ON "tasks" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_feedbacks_created_at" ON "feedbacks" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_submissions_submitted_at" ON "submissions" ("submitted_at");
CREATE INDEX IF NOT EXISTS "idx_claims_claimed_at" ON "claims" ("claimed_at");
CREATE INDEX IF NOT EXISTS "idx_proposals_submitted_at" ON "proposals" ("submitted_at");
CREATE INDEX IF NOT EXISTS "idx_bids_created_at" ON "bids" ("created_at");

-- New append-only column: when the agent first appeared on the platform.
-- Nullable so the additive change is always safe; backfilled below.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
CREATE INDEX IF NOT EXISTS "idx_agents_created_at" ON "agents" ("created_at");

-- Backfill agents.created_at to the earliest related activity for each address,
-- falling back to updated_at when an agent has no engagement records. This makes
-- the "new agents per day" metric meaningful for historical rows. Idempotent:
-- only fills rows that are still NULL, so re-running never overwrites a value.
UPDATE "agents" a
SET "created_at" = COALESCE(
  LEAST(
    (SELECT MIN(s.submitted_at) FROM "submissions" s WHERE s.worker_address = a.address),
    (SELECT MIN(p.submitted_at) FROM "proposals" p WHERE p.worker_address = a.address),
    (SELECT MIN(pr.submitted_at) FROM "proofs" pr WHERE pr.worker_address = a.address),
    (SELECT MIN(c.claimed_at) FROM "claims" c WHERE c.worker_address = a.address),
    (SELECT MIN(b.created_at) FROM "bids" b WHERE b.worker_address = a.address),
    (SELECT MIN(f.created_at) FROM "feedbacks" f WHERE f.worker_address = a.address),
    (SELECT MIN(t.created_at) FROM "tasks" t WHERE t.requester = a.address)
  ),
  a.updated_at
)
WHERE a."created_at" IS NULL;
