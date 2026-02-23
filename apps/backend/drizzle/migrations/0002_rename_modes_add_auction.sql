-- Rename task modes: contest→bounty, instant→claim, proposal→pitch, race→benchmark
-- Add auction mode support: bid_deadline, max_price columns on tasks
-- Add bids table for auction mode
-- statement-breakpoint

-- 1. Rename proposal_deadline → pitch_deadline
ALTER TABLE "tasks" RENAME COLUMN "proposal_deadline" TO "pitch_deadline";
--> statement-breakpoint

-- 2. Add auction-specific columns
ALTER TABLE "tasks" ADD COLUMN "bid_deadline" timestamp;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_price" numeric(78, 0);
--> statement-breakpoint

-- 3. Change default mode to 'bounty'
ALTER TABLE "tasks" ALTER COLUMN "mode" SET DEFAULT 'bounty';
--> statement-breakpoint

-- 4. Migrate existing mode values
UPDATE "tasks" SET "mode" = CASE "mode"
  WHEN 'contest'  THEN 'bounty'
  WHEN 'instant'  THEN 'claim'
  WHEN 'proposal' THEN 'pitch'
  WHEN 'race'     THEN 'benchmark'
  ELSE "mode"
END;
--> statement-breakpoint

-- 5. Create bids table for auction mode
CREATE TABLE "bids" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"worker_address" text NOT NULL,
	"price" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "bids" ADD CONSTRAINT "bids_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

CREATE INDEX "idx_bids_task" ON "bids" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "idx_bids_worker" ON "bids" USING btree ("worker_address");
--> statement-breakpoint
CREATE INDEX "idx_bids_price" ON "bids" USING btree ("price");
