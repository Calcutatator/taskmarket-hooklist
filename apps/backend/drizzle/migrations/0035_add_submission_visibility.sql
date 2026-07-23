-- Adds opt-in submission visibility (ADR-0016: public by default, reveal_all/
-- winner_only/never are opt-in). Independent of task_visibility -- a task's own
-- visibility says nothing about whether its submissions are gated, and vice versa.
-- Chosen once at task creation and locked in permanently: there is no update path
-- for this column anywhere in the application. Default 'public' matches today's
-- always-public submission behavior exactly, so no existing task's submissions are
-- retroactively hidden by this migration.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "submission_visibility" text NOT NULL DEFAULT 'public';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_submission_visibility" ON "tasks" ("submission_visibility");
