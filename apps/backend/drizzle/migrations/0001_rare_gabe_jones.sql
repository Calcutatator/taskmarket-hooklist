CREATE TABLE IF NOT EXISTS "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"api_token_hash" text NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "devices_api_token_hash_unique" UNIQUE("api_token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_wallet_idx" ON "devices" USING btree ("wallet_address");