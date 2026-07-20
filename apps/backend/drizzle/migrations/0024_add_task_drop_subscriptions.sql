CREATE TABLE IF NOT EXISTS "task_drop_subscriptions" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL,
  "wallet_address" text,
  "agent_address" text,
  "source" text NOT NULL DEFAULT 'first_run_panel',
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "unsubscribed_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "uidx_task_drop_subscriptions_email"
  ON "task_drop_subscriptions" (lower("email"));

CREATE INDEX IF NOT EXISTS "idx_task_drop_subscriptions_wallet"
  ON "task_drop_subscriptions" ("wallet_address");

CREATE INDEX IF NOT EXISTS "idx_task_drop_subscriptions_status"
  ON "task_drop_subscriptions" ("status");
