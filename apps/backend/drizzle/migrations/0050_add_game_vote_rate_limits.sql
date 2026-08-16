-- Implements: ADR-0089. Vote abuse limits are durable, shared sliding windows keyed by a
-- one-way digest. This migration is idempotent against the final schema.

CREATE TABLE IF NOT EXISTS "game_vote_rate_limits" (
  "rate_limit_key" text PRIMARY KEY NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "attempts" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_game_vote_rate_limits_updated_at"
  ON "game_vote_rate_limits" ("updated_at");
