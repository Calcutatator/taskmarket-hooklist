ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "self_award" boolean NOT NULL DEFAULT false;
