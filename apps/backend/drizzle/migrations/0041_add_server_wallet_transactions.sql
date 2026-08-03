-- Durable nonce allocation and transaction outbox for the server wallet (ADR-0040).
--
-- Replaces viem's process-local nonce cache, which advanced on a pre-broadcast failure and
-- left a permanent gap that stalled every later relayer transaction until restart
-- (daydreamsai/skills-market#54). The allocator lives in Postgres so it survives restarts
-- and coordinates replicas; the outbox lets broadcast and confirmation proceed without
-- holding a database transaction across RPC calls.
CREATE TABLE IF NOT EXISTS "server_wallet_nonces" (
	"wallet_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"next_nonce" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_wallet_nonces_pkey" PRIMARY KEY ("wallet_address", "chain_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "server_wallet_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"nonce" integer NOT NULL,
	"status" text NOT NULL DEFAULT 'reserved',
	"tx_hash" text,
	"context" text,
	"attempts" integer NOT NULL DEFAULT 0,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"broadcast_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "server_wallet_transactions" ADD CONSTRAINT "server_wallet_transactions_status_check" CHECK ("status" IN ('reserved', 'broadcast', 'confirmed', 'recycled', 'failed'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_server_wallet_transactions_wallet_status" ON "server_wallet_transactions" ("wallet_address", "chain_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_server_wallet_transactions_nonce" ON "server_wallet_transactions" ("wallet_address", "chain_id", "nonce");
