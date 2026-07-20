CREATE TABLE IF NOT EXISTS "requester_reputation_events" (
  "id" serial PRIMARY KEY,
  "task_id" text NOT NULL,
  "requester" text NOT NULL,
  "event_type" text NOT NULL,
  "reward" text NOT NULL,
  "submission_count" integer NOT NULL DEFAULT 0,
  "unique_workers" integer NOT NULL DEFAULT 0,
  "self_award" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON "requester_reputation_events" ("task_id");
CREATE INDEX ON "requester_reputation_events" ("requester");
