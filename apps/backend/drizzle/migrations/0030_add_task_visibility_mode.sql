-- Adds opt-in task visibility mode (ADR-0014: public by default, unlisted is opt-in;
-- ADR-0015 covers the scoped agents.inbox self-auth check that reads this column).
-- Only 'unlisted' and 'public' are valid application-level values for now -- see
-- packages/shared/src/schemas/task.schemas.ts's TaskVisibilityMode for why 'private' is
-- deliberately not offered yet. Default 'public' matches today's always-public
-- behavior exactly, so no existing task is retroactively hidden by this migration.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "task_visibility_mode" text NOT NULL DEFAULT 'public';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_task_visibility_mode" ON "tasks" ("task_visibility_mode");
