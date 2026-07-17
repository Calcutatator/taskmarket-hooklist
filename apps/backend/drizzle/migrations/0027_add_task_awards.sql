CREATE TABLE "task_awards" (
  "id" serial PRIMARY KEY,
  "task_id" text NOT NULL,
  "worker_address" text NOT NULL,
  "rank" integer NOT NULL,
  "worker_payment" numeric(78, 0) NOT NULL,
  "platform_fee" numeric(78, 0) NOT NULL,
  "settlement_tx_hash" text NOT NULL,
  "chain_id" integer NOT NULL,
  "block_number" bigint NOT NULL,
  "log_index" integer NOT NULL,
  "settled_at" timestamptz NOT NULL,
  "rating" smallint,
  CONSTRAINT "task_awards_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id")
    ON DELETE no action ON UPDATE no action
);

CREATE INDEX "idx_task_awards_task" ON "task_awards" ("task_id");
CREATE INDEX "idx_task_awards_worker" ON "task_awards" (lower("worker_address"));
CREATE INDEX "idx_task_awards_task_rank" ON "task_awards" ("task_id", "rank");
CREATE UNIQUE INDEX "uidx_task_awards_chain_block_log"
  ON "task_awards" ("chain_id", "block_number", "log_index");
