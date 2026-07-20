CREATE TABLE IF NOT EXISTS "legal_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"bundle_version" text NOT NULL,
	"bundle_digest" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"acceptance_method" text NOT NULL,
	"document_manifest" jsonb NOT NULL,
	"statement_text" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature" text,
	"challenge" text,
	"session_id" text,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legal_acceptance_challenges" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"bundle_version" text NOT NULL,
	"bundle_digest" text NOT NULL,
	"document_manifest" jsonb NOT NULL,
	"statement_text" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legal_access_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"acceptance_id" text NOT NULL,
	"bundle_version" text NOT NULL,
	"bundle_digest" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "legal_access_receipts_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "legal_access_receipts" ADD CONSTRAINT "legal_access_receipts_acceptance_id_legal_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."legal_acceptances"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_legal_acceptances_subject_bundle_digest" ON "legal_acceptances" USING btree ("subject_type","subject_id","bundle_version","bundle_digest");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_legal_acceptances_bundle" ON "legal_acceptances" USING btree ("bundle_version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_legal_acceptance_challenges_wallet" ON "legal_acceptance_challenges" USING btree ("wallet_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_legal_acceptance_challenges_expires" ON "legal_acceptance_challenges" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_legal_access_receipts_subject" ON "legal_access_receipts" USING btree ("subject_type","subject_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_legal_access_receipts_acceptance" ON "legal_access_receipts" USING btree ("acceptance_id");
