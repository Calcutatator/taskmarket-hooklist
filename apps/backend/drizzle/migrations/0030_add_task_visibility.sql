-- Adds opt-in task visibility (ADR-0011: public by default, unlisted is opt-in;
-- ADR-0012 covers the scoped agents.inbox self-auth check that reads this column).
-- Only 'unlisted' and 'public' are valid application-level values for now -- see
-- packages/shared/src/schemas/task.schemas.ts's TaskVisibility for why 'private' is
-- deliberately not offered yet. Default 'public' matches today's always-public
-- behavior exactly, so no existing task is retroactively hidden by this migration.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'public';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_visibility" ON "tasks" ("visibility");
