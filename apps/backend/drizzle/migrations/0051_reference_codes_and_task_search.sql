-- Implements: ADR-0098
-- Implements: ADR-0099
--
-- Public reference codes for submissions and tasks, and the tsvector the search predicate reads.
-- Every statement is safe to re-apply against the final schema, per AGENTS.md.
--
-- The reference_code columns are nullable here on purpose. Existing rows have no code yet, and the
-- backfill (scripts/backfill-reference-codes.ts) needs the same CSPRNG draw and retry-on-collision
-- behaviour as the write path, so it cannot be expressed as inline SQL. NOT NULL follows in a
-- second migration once the backfill is confirmed against the target database -- the same two-deploy
-- shape as ADR-0008.

ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "reference_code" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reference_code" text;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "submissions_reference_code_unique"
  ON "submissions" ("reference_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_reference_code_unique"
  ON "tasks" ("reference_code");--> statement-breakpoint

-- A generated column may only call IMMUTABLE functions, and `array_to_string` is STABLE -- it is
-- declared that way because an arbitrary element type's output function need not be immutable.
-- For text[] specifically it is immutable (text's output function is), so this wrapper asserts
-- what is already true for the one type it accepts, rather than loosening anything. Without it,
-- Postgres rejects the column outright with 42P17 at cookDefault.
CREATE OR REPLACE FUNCTION "taskmarket_tags_to_text"(text[])
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;--> statement-breakpoint

-- A task has no title column: the title shown throughout the web app is derived by taskTitle() in
-- apps/web/lib/market/task-title.ts as the description's first line. split_part is the SQL analogue
-- of that derivation, so the weight-A field carries the same text a user actually saw as the title
-- rather than an invented one.
--
-- Weighting is title > tags > body, matching how people remember work: what it was called before
-- what it said. The two-argument to_tsvector resolves to to_tsvector(regconfig, text), which is
-- immutable; the single-argument form reads default_text_search_config and is not.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', split_part("description", E'\n', 1)), 'A') ||
    setweight(to_tsvector('english', "taskmarket_tags_to_text"("tags")), 'B') ||
    setweight(to_tsvector('english', "description"), 'C')
  ) STORED;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_tasks_search_vector" ON "tasks" USING GIN ("search_vector");
