-- Records which worker each requestUploadUrl-issued artifactKey was actually generated
-- for, so submitFromKeys can verify the caller presenting a key is the same worker it
-- was issued to, not just that the key's task-id prefix matches.
CREATE TABLE IF NOT EXISTS "pending_upload_keys" (
  "artifact_key" text PRIMARY KEY,
  "task_id" text NOT NULL REFERENCES "tasks"("id"),
  "worker_address" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_upload_keys_task" ON "pending_upload_keys" ("task_id");
