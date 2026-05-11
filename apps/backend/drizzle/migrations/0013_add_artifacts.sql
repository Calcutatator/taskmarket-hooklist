CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL REFERENCES "tasks"("id"),
  "submission_id" text NOT NULL REFERENCES "submissions"("id"),
  "role" text DEFAULT 'attachment' NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "media_kind" text DEFAULT 'unknown' NOT NULL,
  "storage_uri" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "sha256_hash" text NOT NULL,
  "keccak256_hash" text NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_artifacts_task" ON "artifacts" ("task_id");
CREATE INDEX IF NOT EXISTS "idx_artifacts_submission" ON "artifacts" ("submission_id");
