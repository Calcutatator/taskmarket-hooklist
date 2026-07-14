CREATE TABLE "task_drops" (
  "id" text PRIMARY KEY,
  "owner_address" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "idx_task_drops_owner"
  ON "task_drops" (lower("owner_address"));

ALTER TABLE "tasks" ADD COLUMN "task_drop_id" text;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_task_drop_id_task_drops_id_fk"
  FOREIGN KEY ("task_drop_id")
  REFERENCES "task_drops"("id")
  ON DELETE no action
  ON UPDATE no action;

CREATE INDEX "idx_tasks_task_drop"
  ON "tasks" ("task_drop_id");

ALTER TABLE "task_drop_subscriptions" ADD COLUMN "task_drop_id" text;

ALTER TABLE "task_drop_subscriptions"
  ADD CONSTRAINT "task_drop_subscriptions_task_drop_id_task_drops_id_fk"
  FOREIGN KEY ("task_drop_id")
  REFERENCES "task_drops"("id")
  ON DELETE no action
  ON UPDATE no action;

DROP INDEX IF EXISTS "uidx_task_drop_subscriptions_email";

CREATE UNIQUE INDEX "uidx_task_drop_subscriptions_drop_email"
  ON "task_drop_subscriptions" ("task_drop_id", lower("email"))
  WHERE "task_drop_id" IS NOT NULL;

CREATE INDEX "idx_task_drop_subscriptions_drop"
  ON "task_drop_subscriptions" ("task_drop_id");
