CREATE TABLE IF NOT EXISTS "agents" (
	"address" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"completed_tasks" integer DEFAULT 0 NOT NULL,
	"rated_tasks" integer DEFAULT 0 NOT NULL,
	"total_stars" integer DEFAULT 0 NOT NULL,
	"total_earnings" numeric(78, 0) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"worker_address" text NOT NULL,
	"stake_amount" numeric(78, 0) NOT NULL,
	"stake_tx_hash" text NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedbacks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"worker_address" text NOT NULL,
	"worker_agent_id" text,
	"requester_address" text NOT NULL,
	"requester_agent_id" text,
	"rating" smallint NOT NULL,
	"feedback_text" text,
	"file_content" text NOT NULL,
	"rating_tx_hash" text,
	"rating_block_number" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indexer_state" (
	"id" text PRIMARY KEY DEFAULT 'main' NOT NULL,
	"last_block" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"collected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proofs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"worker_address" text NOT NULL,
	"proof_data" text NOT NULL,
	"proof_type" text NOT NULL,
	"metric_value" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"signature" text NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"worker_address" text NOT NULL,
	"proposal_text" text NOT NULL,
	"estimated_duration" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"signature" text NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"worker_address" text NOT NULL,
	"file_url" text NOT NULL,
	"signature" text NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"requester" text NOT NULL,
	"requester_pubkey" text NOT NULL,
	"description" text NOT NULL,
	"reward" numeric(78, 0) NOT NULL,
	"escrow_tx_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expiry_time" timestamp NOT NULL,
	"status" text NOT NULL,
	"tags" text[] NOT NULL,
	"worker" text,
	"rating" smallint,
	"mode" text DEFAULT 'contest' NOT NULL,
	"stake_required" integer DEFAULT 0 NOT NULL,
	"stake_bps" smallint DEFAULT 0 NOT NULL,
	"proposal_deadline" timestamp,
	"metric_description" text,
	"metric_target" text,
	"claimed_by" text,
	"claimed_at" timestamp,
	"platform_fee_bps" smallint DEFAULT 500 NOT NULL,
	"requester_agent_id" text,
	CONSTRAINT "tasks_escrow_tx_hash_unique" UNIQUE("escrow_tx_hash")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "claims" ADD CONSTRAINT "claims_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "proofs" ADD CONSTRAINT "proofs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "proposals" ADD CONSTRAINT "proposals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agents_completed" ON "agents" USING btree ("completed_tasks");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agents_agent_id" ON "agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_task" ON "claims" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_claims_worker" ON "claims" USING btree ("worker_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_feedbacks_task" ON "feedbacks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_feedbacks_worker" ON "feedbacks" USING btree ("worker_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_fees_task" ON "platform_fees" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proofs_task" ON "proofs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proofs_worker" ON "proofs" USING btree ("worker_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proposals_task" ON "proposals" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proposals_worker" ON "proposals" USING btree ("worker_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_proposals_status" ON "proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_submissions_task" ON "submissions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_submissions_worker" ON "submissions" USING btree ("worker_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_status" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_expiry" ON "tasks" USING btree ("expiry_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_requester" ON "tasks" USING btree ("requester");--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'worker'
  ) THEN
    CREATE INDEX IF NOT EXISTS "idx_tasks_worker" ON "tasks" USING btree ("worker");
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_mode" ON "tasks" USING btree ("mode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_claimed_by" ON "tasks" USING btree ("claimed_by");