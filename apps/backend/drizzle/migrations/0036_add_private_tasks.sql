-- Phase 3 (true private tasks, ADR-0030): 'private' added to task_visibility's allowed
-- application-level values (no ALTER TYPE needed -- task_visibility is a plain text
-- column with app-level enum validation only, see 0031). The column itself needs no
-- migration; only the new storage for the two invite mechanisms (wallet allowlist,
-- password) and the password-verify rate limiter does.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "private_access_password_hash" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_allowed_viewers" (
  "id" serial PRIMARY KEY,
  "task_id" text NOT NULL REFERENCES "tasks"("id"),
  "viewer_address" text NOT NULL,
  "added_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_allowed_viewers_task" ON "task_allowed_viewers" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_allowed_viewers_viewer" ON "task_allowed_viewers" ("viewer_address");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_allowed_viewers_task_viewer_unique" ON "task_allowed_viewers" ("task_id", "viewer_address");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_access_grants" (
  "id" text PRIMARY KEY,
  "task_id" text NOT NULL REFERENCES "tasks"("id"),
  "token_hash" text NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_access_grants_token_hash_unique" ON "task_access_grants" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_access_grants_task" ON "task_access_grants" ("task_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_access_grants_expires" ON "task_access_grants" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_access_password_rate_limits" (
  "rate_limit_key" text PRIMARY KEY,
  "window_started_at" timestamp (3) with time zone NOT NULL,
  "attempts" integer NOT NULL,
  "updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
