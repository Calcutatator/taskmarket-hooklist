ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "xmtp_inbox_id" text;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "xmtp_enabled" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "xmtp_last_seen_at" timestamp;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_xmtp_installations" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_address" text NOT NULL,
  "device_id" text NOT NULL,
  "inbox_id" text NOT NULL,
  "installation_id" text NOT NULL,
  "db_path" text,
  "client_version" text,
  "status" text DEFAULT 'active' NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "agent_xmtp_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_xmtp_peer_policies" (
  "id" serial PRIMARY KEY NOT NULL,
  "owner_agent_address" text NOT NULL,
  "peer_inbox_id" text NOT NULL,
  "policy" text DEFAULT 'allow' NOT NULL,
  "reason" text,
  "updated_by_device_id" text,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "agent_xmtp_installations" ADD CONSTRAINT "agent_xmtp_installations_agent_address_agents_address_fk" FOREIGN KEY ("agent_address") REFERENCES "public"."agents"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_xmtp_installations" ADD CONSTRAINT "agent_xmtp_installations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_xmtp_peer_policies" ADD CONSTRAINT "agent_xmtp_peer_policies_owner_agent_address_agents_address_fk" FOREIGN KEY ("owner_agent_address") REFERENCES "public"."agents"("address") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agent_xmtp_peer_policies" ADD CONSTRAINT "agent_xmtp_peer_policies_updated_by_device_id_devices_id_fk" FOREIGN KEY ("updated_by_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_agent_xmtp_installations_agent" ON "agent_xmtp_installations" USING btree ("agent_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_xmtp_installations_inbox" ON "agent_xmtp_installations" USING btree ("inbox_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_xmtp_installations_status" ON "agent_xmtp_installations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_xmtp_peer_policies_owner" ON "agent_xmtp_peer_policies" USING btree ("owner_agent_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_xmtp_peer_policies_peer" ON "agent_xmtp_peer_policies" USING btree ("peer_inbox_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_agent_xmtp_peer_policies_owner_peer" ON "agent_xmtp_peer_policies" USING btree ("owner_agent_address", "peer_inbox_id");
