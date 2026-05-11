ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "chain_id" integer;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "contract_address" text;
