-- Implements: ADR-0100
--
-- Wallet-scoped saved lists, private by default. Every statement is safe to re-apply against the
-- final schema, per AGENTS.md.

CREATE TABLE IF NOT EXISTS "bookmark_collections" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_address" text NOT NULL,
  "name" text NOT NULL,
  "published_slug" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bookmarks" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_address" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "collection_id" text REFERENCES "bookmark_collections"("id"),
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_bookmark_collections_owner"
  ON "bookmark_collections" ("owner_address");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bookmark_collections_slug_unique"
  ON "bookmark_collections" ("published_slug");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_bookmarks_owner" ON "bookmarks" ("owner_address");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bookmarks_collection" ON "bookmarks" ("collection_id");--> statement-breakpoint

-- One row per (owner, entity): a double-tap on the bookmark control is a no-op, not a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "bookmarks_owner_entity_unique"
  ON "bookmarks" ("owner_address", "entity_type", "entity_id");
