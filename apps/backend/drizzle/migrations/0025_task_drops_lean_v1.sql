CREATE TABLE IF NOT EXISTS "task_drops" (
  "id" text PRIMARY KEY,
  "owner_address" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_task_drops_owner"
  ON "task_drops" (lower("owner_address"));

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "task_drop_id" text;

DO $$ BEGIN
  ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_task_drop_id_task_drops_id_fk"
  FOREIGN KEY ("task_drop_id")
  REFERENCES "task_drops"("id")
  ON DELETE no action
  ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_tasks_task_drop"
  ON "tasks" ("task_drop_id");

ALTER TABLE "task_drop_subscriptions" ADD COLUMN IF NOT EXISTS "task_drop_id" text;

DO $$ BEGIN
  ALTER TABLE "task_drop_subscriptions"
  ADD CONSTRAINT "task_drop_subscriptions_task_drop_id_task_drops_id_fk"
  FOREIGN KEY ("task_drop_id")
  REFERENCES "task_drops"("id")
  ON DELETE no action
  ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS "uidx_task_drop_subscriptions_email";

CREATE UNIQUE INDEX IF NOT EXISTS "uidx_task_drop_subscriptions_drop_email"
  ON "task_drop_subscriptions" ("task_drop_id", lower("email"))
  WHERE "task_drop_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_task_drop_subscriptions_drop"
  ON "task_drop_subscriptions" ("task_drop_id");
