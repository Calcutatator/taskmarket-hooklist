ALTER TABLE "task_drops" ADD COLUMN "announced_at" timestamptz(3);

CREATE TABLE "task_drop_task_reservations" (
  "reservation_id" text PRIMARY KEY,
  "task_drop_id" text NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "task_drop_task_reservations_task_drop_id_fk"
    FOREIGN KEY ("task_drop_id") REFERENCES "task_drops"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_task_drop_task_reservations_drop"
  ON "task_drop_task_reservations" ("task_drop_id");

ALTER TABLE "task_drop_subscriptions" ADD COLUMN "subscription_scope" text;

UPDATE "task_drop_subscriptions"
SET "subscription_scope" = CASE
  WHEN "task_drop_id" IS NULL THEN 'legacy'
  ELSE 'drop'
END;

ALTER TABLE "task_drop_subscriptions"
  ALTER COLUMN "subscription_scope" SET NOT NULL;

ALTER TABLE "task_drop_subscriptions"
  ALTER COLUMN "subscription_scope" SET DEFAULT 'drop';

ALTER TABLE "task_drop_subscriptions" ADD COLUMN "consented_at" timestamptz(3);

UPDATE "task_drop_subscriptions"
SET "consented_at" = "created_at";

ALTER TABLE "task_drop_subscriptions"
  ALTER COLUMN "consented_at" SET NOT NULL;

ALTER TABLE "task_drop_subscriptions"
  ALTER COLUMN "consented_at" SET DEFAULT now();

ALTER TABLE "task_drop_subscriptions"
  ADD CONSTRAINT "task_drop_subscriptions_scope_drop_check"
  CHECK (
    ("subscription_scope" = 'drop' AND "task_drop_id" IS NOT NULL)
    OR
    ("subscription_scope" IN ('official', 'legacy') AND "task_drop_id" IS NULL)
  );

CREATE UNIQUE INDEX "uidx_task_drop_subscriptions_official_email"
  ON "task_drop_subscriptions" (lower("email"))
  WHERE "subscription_scope" = 'official';

CREATE INDEX "idx_task_drop_subscriptions_scope"
  ON "task_drop_subscriptions" ("subscription_scope");

CREATE TABLE "task_drop_subscribe_rate_limits" (
  "rate_limit_key" text PRIMARY KEY,
  "window_started_at" timestamptz(3) NOT NULL,
  "attempts" integer NOT NULL,
  "updated_at" timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE "task_drop_announcement_deliveries" (
  "id" text PRIMARY KEY,
  "task_drop_id" text NOT NULL,
  "subscription_id" text NOT NULL,
  "subscription_consented_at" timestamptz(3) NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "processing_at" timestamptz(3),
  "last_error" text,
  "sent_at" timestamptz(3),
  "created_at" timestamptz(3) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "task_drop_announcement_deliveries_task_drop_id_fk"
    FOREIGN KEY ("task_drop_id") REFERENCES "task_drops"("id"),
  CONSTRAINT "task_drop_announcement_deliveries_subscription_id_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "task_drop_subscriptions"("id"),
  CONSTRAINT "task_drop_announcement_deliveries_status_check"
    CHECK ("status" IN ('pending', 'processing', 'sent', 'failed', 'skipped'))
);

CREATE UNIQUE INDEX "uidx_task_drop_announcement_delivery_subscription"
  ON "task_drop_announcement_deliveries" ("task_drop_id", "subscription_id");

CREATE INDEX "idx_task_drop_announcement_deliveries_drop"
  ON "task_drop_announcement_deliveries" ("task_drop_id");

CREATE INDEX "idx_task_drop_announcement_deliveries_status"
  ON "task_drop_announcement_deliveries" ("status");
