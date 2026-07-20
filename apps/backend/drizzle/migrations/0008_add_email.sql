ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "email_address" text UNIQUE;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "emails" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text UNIQUE,
  "from_address" text NOT NULL,
  "to_address" text NOT NULL,
  "agent_address" text NOT NULL,
  "subject" text,
  "body_text" text,
  "body_html" text,
  "is_read" integer DEFAULT 0 NOT NULL,
  "received_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "emails_agent_address_agents_address_fk" FOREIGN KEY ("agent_address") REFERENCES "public"."agents"("address") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_emails_agent" ON "emails" USING btree ("agent_address");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_emails_received" ON "emails" USING btree ("received_at");
