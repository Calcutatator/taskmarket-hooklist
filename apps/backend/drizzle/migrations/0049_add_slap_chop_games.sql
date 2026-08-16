-- Implements: ADR-0087 (immutable Taskmarket artifact pins) and ADR-0090 (backend-owned rank
-- inputs). Every statement is safe to re-apply against the final schema, per AGENTS.md.

CREATE TABLE IF NOT EXISTS "games" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "creator_name" text,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "task_id" text NOT NULL REFERENCES "tasks"("id"),
  "submission_id" text NOT NULL REFERENCES "submissions"("id"),
  "artifact_id" text NOT NULL REFERENCES "artifacts"("id"),
  "artifact_sha256_hash" text NOT NULL,
  "artifact_keccak256_hash" text NOT NULL,
  "artifact_mime_type" text NOT NULL,
  "artifact_size_bytes" integer NOT NULL,
  "cover_source" text,
  "cover_artifact_id" text REFERENCES "artifacts"("id"),
  "cover_storage_uri" text,
  "cover_sha256_hash" text,
  "cover_mime_type" text,
  "cover_width" integer,
  "cover_height" integer,
  "cover_alt_text" text,
  "previewed_at" timestamp with time zone,
  "upvote_count" integer DEFAULT 0 NOT NULL,
  "downvote_count" integer DEFAULT 0 NOT NULL,
  "published_at" timestamp with time zone,
  "hidden_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "games_status_check" CHECK ("status" IN ('draft', 'published', 'hidden')),
  CONSTRAINT "games_vote_counts_check" CHECK ("upvote_count" >= 0 AND "downvote_count" >= 0),
  CONSTRAINT "games_artifact_size_check" CHECK ("artifact_size_bytes" >= 0),
  CONSTRAINT "games_cover_source_check" CHECK (
    "cover_source" IS NULL OR "cover_source" IN ('artifact', 'catalog_asset')
  ),
  CONSTRAINT "games_cover_dimensions_check" CHECK (
    ("cover_width" IS NULL OR "cover_width" > 0)
    AND ("cover_height" IS NULL OR "cover_height" > 0)
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uidx_games_slug" ON "games" ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_games_status_published_at"
  ON "games" ("status", "published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_games_task" ON "games" ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_games_submission" ON "games" ("submission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_games_artifact" ON "games" ("artifact_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "game_votes" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id") ON DELETE cascade,
  "privy_user_id" text NOT NULL,
  "value" smallint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "game_votes_value_check" CHECK ("value" IN (-1, 1))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_game_votes_game" ON "game_votes" ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_game_votes_game_privy_user"
  ON "game_votes" ("game_id", "privy_user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "game_curation_events" (
  "id" text PRIMARY KEY NOT NULL,
  "game_id" text NOT NULL REFERENCES "games"("id"),
  "actor_privy_user_id" text NOT NULL,
  "action" text NOT NULL,
  "before_metadata" jsonb,
  "after_metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_game_curation_events_game_created_at"
  ON "game_curation_events" ("game_id", "created_at");
