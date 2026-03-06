ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "auction_type" text;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "auction_start_price" numeric(78, 0);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "auction_floor_price" numeric(78, 0);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bids" ADD CONSTRAINT "bids_task_worker_unique" UNIQUE ("task_id", "worker_address");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
