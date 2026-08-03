-- Durable record of a relayed write (ADR-0045).
--
-- Created before any payment-consuming or chain-mutating step, so the work survives the
-- request that started it. Before this, the database write for a created task happened
-- inline after waitForTransactionReceipt: a receipt arriving after the caller had gone
-- left a funded, created, on-chain task with no row here and no notification, and a
-- timeout was treated as failure and refunded a transaction that could still land.
CREATE TABLE IF NOT EXISTS "relayed_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL DEFAULT 'recorded',
	"payer" text,
	"payment_tx_hash" text,
	"payment_amount" numeric(78, 0),
	"payload" jsonb NOT NULL,
	"server_wallet_transaction_id" text,
	"tx_hash" text,
	"completion_attempts" integer NOT NULL DEFAULT 0,
	-- Counted separately from completion_attempts: an intent can be broadcast once and
	-- completed several times, so one counter cannot bound both.
	"broadcast_attempts" integer NOT NULL DEFAULT 0,
	-- The relay envelope, fixed when the intent is recorded and replayed verbatim on every
	-- rebroadcast. Recomputing either on retry would hand each attempt a fresh 300-second
	-- window, so the deadline would never arrive and the only real bound on retrying would be
	-- gone -- unbounded retry wearing a deadline as a disguise. Held here so the value that
	-- goes on chain is the same one every time, and TaskMarketForwarder.relay's ReceiptExpired
	-- is what ends it.
	"relay_valid_before" numeric(20, 0),
	"relay_receipt_nonce" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "relayed_intents" ADD CONSTRAINT "relayed_intents_status_check" CHECK ("status" IN ('recorded', 'broadcast', 'completed', 'failed'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relayed_intents_status" ON "relayed_intents" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relayed_intents_server_wallet_tx" ON "relayed_intents" ("server_wallet_transaction_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_relayed_intents_payer" ON "relayed_intents" ("payer");
--> statement-breakpoint
-- One intent per settled payment: a retried request reusing the same x402 payment must not
-- create a second intent and a second chain call for one payment.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_relayed_intents_payment_tx" ON "relayed_intents" ("payment_tx_hash");
